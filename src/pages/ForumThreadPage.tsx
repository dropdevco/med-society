import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useMyClinic } from '../hooks/useMyClinic';
import { useIsClinician } from '../hooks/useIsClinician';
import {
    deleteReply, deleteThread, getThread, listReplies, myHelpful, setHelpful,
    type ForumKind, type ForumReply, type ForumThread,
} from '../lib/forum';
import { FORUM_PATH } from '../lib/forumRoutes';
import { useNoIndex } from '../hooks/useNoIndex';
import { AuthorLine, SpecialtyTag } from '../components/forum/ForumParts';
import { ReplyComposer } from '../components/forum/Composers';
import { ClinicianGate } from '../components/forum/ClinicianGate';
import { IconChevronLeft, IconCheck } from '../components/icons/Icons';
import '../components/forum/forum.css';

/**
 * One question (or discussion) and its replies.
 *
 * Who sees a reply box, mirroring the insert policy in 0015_forums.sql:
 *   patients  clinicians answer as a listing; the asker may follow up;
 *             everyone else is told who answers here and how to become one.
 *   society   clinicians, as a listing. Nobody else gets this far.
 */
export function ForumThreadPage({ forum }: { forum: ForumKind }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { threadId } = useParams<{ threadId: string }>();
    const { user, loading: sessionLoading } = useSession();
    const { isClinician, loading: clinicianLoading } = useIsClinician(user?.id ?? null);
    const { owned } = useMyClinic(user?.id ?? null);

    const [thread, setThread] = useState<ForumThread | null>(null);
    const [replies, setReplies] = useState<ForumReply[]>([]);
    // Which thread `replies` belongs to; until it is this one, say nothing
    // about answers rather than "waiting for a doctor" on an answered thread.
    const [repliesFor, setRepliesFor] = useState<string | null>(null);
    const [helpful, setHelpfulSet] = useState<Set<string>>(new Set());
    const [loadedId, setLoadedId] = useState<string | null>(null);
    const loading = loadedId !== threadId;

    const base = FORUM_PATH[forum];
    useNoIndex();
    const gated = forum === 'society' && !isClinician && !clinicianLoading && !sessionLoading;
    const userId = user?.id ?? null;

    const loadReplies = useCallback(async (th: ForumThread) => {
        const rows = await listReplies(th);
        setReplies(rows);
        setRepliesFor(th.id);
        if (userId) setHelpfulSet(await myHelpful(rows.map((r) => r.id)));
    }, [userId]);

    useEffect(() => {
        if (!threadId || gated) return;
        let cancelled = false;
        void getThread(threadId).then(async (th) => {
            if (cancelled) return;
            // A thread from the other forum under this URL is a wrong link,
            // not a page to render with the wrong rules.
            const ok = th && th.forum === forum ? th : null;
            setThread(ok);
            // The question renders now; its replies fill in when they land.
            setLoadedId(threadId);
            if (ok) {
                document.title = `${ok.title} · MedSociety`;
                await loadReplies(ok);
            }
        });
        return () => { cancelled = true; };
    }, [threadId, forum, gated, loadReplies]);

    if (forum === 'society' && (sessionLoading || clinicianLoading)) {
        return <Shell><div className="skeleton" style={{ height: 200, borderRadius: 'var(--radius)' }} /></Shell>;
    }
    if (gated) return <ClinicianGate signedIn={!!user} />;

    if (loading) {
        return <Shell><div className="skeleton" style={{ height: 200, borderRadius: 'var(--radius)' }} /></Shell>;
    }

    if (!thread) {
        return (
            <Shell>
                <div className="forum-empty">
                    <p><strong>{t('forum.notFound')}</strong></p>
                    <Link to={base} className="forum-btn-ghost press">{t('forum.backToList')}</Link>
                </div>
            </Shell>
        );
    }

    const isAsker = !!userId && thread.author_id === userId;
    const toggleHelpful = async (r: ForumReply) => {
        if (!userId) { navigate(`/login?next=${encodeURIComponent(`${base}/${thread.id}`)}`); return; }
        const on = !helpful.has(r.id);
        const next = new Set(helpful);
        if (on) next.add(r.id); else next.delete(r.id);
        setHelpfulSet(next);
        setReplies((rs) => rs.map((x) => x.id === r.id ? { ...x, helpful_count: x.helpful_count + (on ? 1 : -1) } : x));
        const { error } = await setHelpful(r.id, on);
        if (error) void loadReplies(thread);
    };

    const removeThread = async () => {
        if (!window.confirm(t('forum.deleteConfirm'))) return;
        const { error } = await deleteThread(thread.id);
        if (!error) navigate(base, { replace: true });
    };
    const removeReply = async (id: string) => {
        if (!window.confirm(t('forum.deleteConfirm'))) return;
        const { error } = await deleteReply(id);
        if (!error) void loadReplies(thread);
    };

    const doctorCount = replies.filter((r) => r.provider_id).length;

    return (
        <Shell>
            <Link to={base} className="forum-back">
                <IconChevronLeft size={16} weight={2} />
                {forum === 'patients' ? t('nav.askDoctor') : t('nav.medSociety')}
            </Link>

            <article className="forum-thread">
                <div className="forum-card-top">
                    {thread.is_prompt && <span className="forum-tag is-accent">{t('forum.teamPrompt')}</span>}
                    <SpecialtyTag specialty={thread.specialty} />
                </div>
                <h1 className="display forum-thread-title">{thread.title}</h1>
                <AuthorLine name={thread.author_name} clinic={thread.clinic} isPrompt={thread.is_prompt} at={thread.created_at} />
                {thread.body && <p className="forum-thread-body">{thread.body}</p>}
                {isAsker && (
                    <button className="forum-link-btn" onClick={removeThread}>{t('forum.delete')}</button>
                )}
            </article>

            {repliesFor !== thread.id ? (
                <div className="skeleton" style={{ height: 120, borderRadius: 'var(--radius)' }} />
            ) : (<>
            <h2 className="forum-replies-head">
                {forum === 'patients'
                    ? (doctorCount > 0 ? t('forum.doctorAnswers', { count: doctorCount }) : t('forum.awaitingDoctor'))
                    : t('forum.replies', { count: replies.length })}
            </h2>

            <div className="forum-replies">
                {replies.map((r) => (
                    <div key={r.id} className={`forum-reply${r.provider_id && forum === 'patients' ? ' is-doctor' : ''}`}>
                        <AuthorLine name={r.author_name} clinic={r.clinic} at={r.created_at} />
                        <p className="forum-reply-body">{r.body}</p>
                        <div className="forum-reply-foot">
                            {r.author_id !== userId && (
                                <button
                                    className={`forum-helpful press${helpful.has(r.id) ? ' is-on' : ''}`}
                                    aria-pressed={helpful.has(r.id)}
                                    onClick={() => void toggleHelpful(r)}
                                >
                                    <IconCheck size={14} weight={2} />
                                    {t('forum.helpful')}{r.helpful_count > 0 && ` · ${r.helpful_count}`}
                                </button>
                            )}
                            {r.author_id === userId && (
                                <button className="forum-link-btn" onClick={() => void removeReply(r.id)}>{t('forum.delete')}</button>
                            )}
                            {r.clinic && forum === 'patients' && (
                                <Link to={`/providers/${r.clinic.id}`} className="forum-link-btn">
                                    {t('forum.viewDoctorProfile')}
                                </Link>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            </>)}

            {isClinician && owned.length > 0 ? (
                <ReplyComposer threadId={thread.id} clinics={owned} onPosted={() => void loadReplies(thread)} />
            ) : isAsker ? (
                <ReplyComposer threadId={thread.id} clinics={[]} followUpName={thread.author_name} onPosted={() => void loadReplies(thread)} />
            ) : (
                <div className="forum-banner">
                    <div>
                        <strong>{t('forum.onlyDoctorsTitle')}</strong>
                        <p>{t('forum.onlyDoctorsBody')}</p>
                    </div>
                    <Link
                        to={user
                            ? `${FORUM_PATH.patients}?compose=1`
                            : `/login?mode=signup&next=${encodeURIComponent(`${FORUM_PATH.patients}?compose=1`)}`}
                        className="forum-btn-ghost press"
                    >
                        {t('forum.askYourOwn')}
                    </Link>
                </div>
            )}

            {forum === 'patients' && <p className="forum-disclaimer">{t('forum.disclaimer')}</p>}
        </Shell>
    );
}

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <main className="ms-page forum-page" id="main-content">
            <div className="forum-wrap is-narrow">{children}</div>
        </main>
    );
}
