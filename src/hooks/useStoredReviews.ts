import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { timeAgo } from '../utils/timeAgo';
import type { ReviewItem } from '../types/review';

/** What `public.provider_reviews` returns (migration 0027). The author is already abbreviated there. */
interface Row {
    author_label: string | null;
    rating: number | string;
    published_at: string | null;
    body: string;
    body_es: string | null;
    body_en: string | null;
    source_lang: string | null;
}

/** "Some of their reviews": the latest handful, not the whole archive. */
const LIMIT = 10;

/**
 * Rows already fetched this session, by provider. Language is applied when the
 * rows are shown, not when they are fetched, so switching EN/ES re-renders
 * instantly instead of asking again. A failed fetch is never cached, so
 * reopening the clinic tries once more.
 */
const cache = new Map<string, Row[]>();

/**
 * The reviews we hold for a clinic — Doctoralia's, scraped and stored — for its
 * page and modal. Google listings get theirs live from Places
 * (useGoogleReviews); these are the listings that have no Google place, which
 * is most of the directory and was showing no reviews at all.
 *
 * Pass undefined for a provider that has none to fetch (no Doctoralia id): the
 * hook then does nothing and reports `loading: false`, so a Google-only clinic
 * never flashes a skeleton for reviews that cannot exist.
 *
 * Never invents anything: an error, an unknown clinic or a clinic with no
 * written reviews all come back as an empty list.
 */
export function useStoredReviews(providerId?: string) {
    const { t, i18n } = useTranslation();
    const lang = i18n.language?.slice(0, 2) === 'es' ? 'es' : 'en';
    const [fetched, setFetched] = useState<{ id: string; rows: Row[] } | null>(null);

    useEffect(() => {
        if (!providerId || !supabase || cache.has(providerId)) return;
        let cancelled = false;
        supabase.rpc('provider_reviews', { p_provider_id: providerId, p_limit: LIMIT }).then(({ data, error }) => {
            if (cancelled) return;
            const rows = error ? [] : ((data as Row[] | null) ?? []);
            if (!error) cache.set(providerId, rows);
            setFetched({ id: providerId, rows });
        });
        return () => {
            cancelled = true;
        };
    }, [providerId]);

    const rows = providerId ? (cache.get(providerId) ?? (fetched?.id === providerId ? fetched.rows : null)) : null;

    const reviews = useMemo<ReviewItem[]>(
        () =>
            (rows ?? []).map((r) => {
                // The visitor's language when we have it, else what was written.
                const preferred = lang === 'es' ? r.body_es : r.body_en;
                const text = preferred?.trim() ? preferred : r.body;
                return {
                    author_name: r.author_label ?? t('reviews.patient'),
                    rating: Math.min(5, Math.max(1, Math.round(Number(r.rating)))),
                    text,
                    relative_time_description: r.published_at ? timeAgo(r.published_at, i18n.language) : '',
                    translated: text !== r.body && !!r.source_lang && r.source_lang !== lang,
                };
            }),
        [rows, lang, t, i18n.language],
    );

    return { reviews, loading: Boolean(providerId) && Boolean(supabase) && rows === null };
}
