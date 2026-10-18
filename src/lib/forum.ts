import { supabase } from './supabase';
import { track } from './posthog';

/**
 * The two forums: "Ask a Doctor" (`patients`, public) and "Med Society"
 * (`society`, clinicians only). Who may read and write what is enforced by RLS
 * in supabase/migrations/0015_forums.sql; nothing here is a permission check,
 * only a way to ask. Like lib/auth.ts, every write returns `{ error }` rather
 * than throwing.
 */

export type ForumKind = 'patients' | 'society';

/** The listing a clinician posts as: what turns an answer into marketing. */
export interface ForumAuthorClinic {
    id: string;
    name: string;
    imageUrl: string | null;
    specialty: string[];
    city: string | null;
}

export interface ForumThread {
    id: string;
    forum: ForumKind;
    author_id: string | null;
    author_name: string;
    provider_id: string | null;
    title: string;
    body: string;
    specialty: string | null;
    is_prompt: boolean;
    pinned: boolean;
    reply_count: number;
    doctor_reply_count: number;
    last_activity_at: string;
    created_at: string;
    clinic?: ForumAuthorClinic | null;
}

export interface ForumReply {
    id: string;
    thread_id: string;
    author_id: string | null;
    author_name: string;
    provider_id: string | null;
    body: string;
    helpful_count: number;
    created_at: string;
    clinic?: ForumAuthorClinic | null;
}

export type ThreadSort = 'recent' | 'unanswered';

/**
 * The listing behind a clinician post is embedded rather than fetched after:
 * one round trip instead of two. It is a left join, so a listing RLS hides
 * from this viewer (still pending review) comes back null and the post falls
 * back to `author_name` instead of disappearing.
 */
const CLINIC_EMBED = 'clinic:providers(id, name, imageUrl, specialty, city)';
const THREAD_COLS =
    `id, forum, author_id, author_name, provider_id, title, body, specialty, is_prompt, pinned, reply_count, doctor_reply_count, last_activity_at, created_at, ${CLINIC_EMBED}`;
const REPLY_COLS =
    `id, thread_id, author_id, author_name, provider_id, body, helpful_count, created_at, ${CLINIC_EMBED}`;

export const PAGE_SIZE = 20;

export async function listThreads(opts: {
    forum: ForumKind;
    sort: ThreadSort;
    specialty?: string | null;
    query?: string;
    page?: number;
}): Promise<{ threads: ForumThread[]; hasMore: boolean; error: string | null }> {
    if (!supabase) return { threads: [], hasMore: false, error: null };
    const page = opts.page ?? 0;

    let q = supabase.from('forum_threads').select(THREAD_COLS).eq('forum', opts.forum);
    if (opts.specialty) q = q.eq('specialty', opts.specialty);
    if (opts.sort === 'unanswered') q = q.eq('doctor_reply_count', 0);
    const term = opts.query?.trim().replace(/[%,()]/g, ' ');
    if (term) q = q.or(`title.ilike.%${term}%,body.ilike.%${term}%`);

    // Pinned first only on the default view; "unanswered" is a work queue,
    // and a pinned prompt at the top of it is noise.
    if (opts.sort === 'recent') q = q.order('pinned', { ascending: false });
    q = q
        .order(opts.sort === 'recent' ? 'last_activity_at' : 'created_at', { ascending: false })
        // One extra row tells us whether there is a next page without a count.
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    const { data, error } = await q;
    if (error) return { threads: [], hasMore: false, error: error.message };
    const rows = (data ?? []) as unknown as ForumThread[];
    return {
        threads: rows.slice(0, PAGE_SIZE),
        hasMore: rows.length > PAGE_SIZE,
        error: null,
    };
}

export async function getThread(id: string): Promise<ForumThread | null> {
    if (!supabase) return null;
    const { data } = await supabase.from('forum_threads').select(THREAD_COLS).eq('id', id).maybeSingle();
    return (data as unknown as ForumThread | null) ?? null;
}

/**
 * Replies in reading order, with clinician answers first in the patients
 * forum. A patient opening their question wants the doctor's answer, not
 * their own follow-up, at the top.
 */
export async function listReplies(thread: ForumThread): Promise<ForumReply[]> {
    if (!supabase) return [];
    const { data } = await supabase
        .from('forum_replies')
        .select(REPLY_COLS)
        .eq('thread_id', thread.id)
        .order('created_at', { ascending: true });
    const rows = (data ?? []) as unknown as ForumReply[];
    if (thread.forum !== 'patients') return rows;
    return [...rows].sort((a, b) =>
        Number(!!b.provider_id) - Number(!!a.provider_id) || b.helpful_count - a.helpful_count,
    );
}

/** The reply ids, out of `ids`, that this user has marked helpful. */
export async function myHelpful(ids: string[]): Promise<Set<string>> {
    if (!supabase || ids.length === 0) return new Set();
    const { data } = await supabase.from('forum_helpful').select('reply_id').in('reply_id', ids);
    return new Set((data ?? []).map((r) => r.reply_id as string));
}

export async function setHelpful(replyId: string, on: boolean): Promise<{ error: string | null }> {
    if (!supabase) return { error: 'Not configured' };
    const { error } = on
        ? await supabase.from('forum_helpful').insert({ reply_id: replyId })
        : await supabase.from('forum_helpful').delete().eq('reply_id', replyId);
    if (on && !error) track('forum_helpful_marked');
    return { error: error?.message ?? null };
}

/**
 * Tell the server a post exists, so it can send whatever email the post
 * warrants (api/forum-notify.ts decides; most posts warrant none). Fire and
 * forget: `keepalive` lets it finish as the page navigates to the new thread,
 * and if it is lost anyway the daily sweep sends it late rather than never.
 */
function notify(kind: 'thread' | 'reply', id: string) {
    void fetch('/api/forum-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id }),
        keepalive: true,
    }).catch(() => { /* the sweep covers it */ });
}

export async function createThread(input: {
    forum: ForumKind;
    authorName: string;
    providerId: string | null;
    title: string;
    body: string;
    specialty: string | null;
    /** UI language, so a reply notification is written in it. */
    lang: 'en' | 'es';
}): Promise<{ id: string | null; error: string | null }> {
    if (!supabase) return { id: null, error: 'Not configured' };
    const { data, error } = await supabase
        .from('forum_threads')
        .insert({
            forum: input.forum,
            author_name: input.authorName.trim(),
            provider_id: input.providerId,
            title: input.title.trim(),
            body: input.body.trim(),
            specialty: input.specialty,
            lang: input.lang,
        })
        .select('id')
        .single();
    if (data?.id) notify('thread', data.id as string);
    track('forum_thread_created', { forum: input.forum, ok: !error, specialty: input.specialty, as_clinic: input.providerId !== null });
    return { id: (data?.id as string) ?? null, error: error?.message ?? null };
}

export async function createReply(input: {
    threadId: string;
    authorName: string;
    providerId: string | null;
    body: string;
}): Promise<{ error: string | null }> {
    if (!supabase) return { error: 'Not configured' };
    const { data, error } = await supabase
        .from('forum_replies')
        .insert({
            thread_id: input.threadId,
            author_name: input.authorName.trim(),
            provider_id: input.providerId,
            body: input.body.trim(),
        })
        .select('id')
        .single();
    if (data?.id) notify('reply', data.id as string);
    track('forum_reply_created', { ok: !error, as_clinic: input.providerId !== null });
    return { error: error?.message ?? null };
}

export async function deleteThread(id: string): Promise<{ error: string | null }> {
    if (!supabase) return { error: 'Not configured' };
    const { error } = await supabase.from('forum_threads').delete().eq('id', id);
    return { error: error?.message ?? null };
}

export async function deleteReply(id: string): Promise<{ error: string | null }> {
    if (!supabase) return { error: 'Not configured' };
    const { error } = await supabase.from('forum_replies').delete().eq('id', id);
    return { error: error?.message ?? null };
}

/** A clinician's public answers, for "Answers from this doctor" on their page. */
export async function listAnswersByProvider(providerId: string, limit = 3): Promise<{
    total: number;
    answers: { id: string; body: string; created_at: string; thread: { id: string; title: string } }[];
}> {
    if (!supabase) return { total: 0, answers: [] };
    // The inner join on a patients-forum thread keeps Med Society talk off the
    // public profile even for a viewer who happens to be a clinician.
    const { data, count } = await supabase
        .from('forum_replies')
        .select('id, body, created_at, thread:forum_threads!inner(id, title, forum)', { count: 'exact' })
        .eq('provider_id', providerId)
        .eq('thread.forum', 'patients')
        .order('created_at', { ascending: false })
        .limit(limit);
    type Row = { id: string; body: string; created_at: string; thread: { id: string; title: string } };
    return { total: count ?? 0, answers: (data ?? []) as unknown as Row[] };
}

/** Questions from patients no clinician has answered yet, in these specialties. */
export async function countUnanswered(specialties: string[]): Promise<number> {
    if (!supabase) return 0;
    let q = supabase
        .from('forum_threads')
        .select('id', { count: 'exact', head: true })
        .eq('forum', 'patients')
        .eq('doctor_reply_count', 0);
    // Untagged questions count too: "is this normal?" is anyone's to answer.
    if (specialties.length > 0) q = q.or(`specialty.in.(${specialties.join(',')}),specialty.is.null`);
    const { count } = await q;
    return count ?? 0;
}
