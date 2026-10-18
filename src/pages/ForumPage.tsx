import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useMyClinic } from '../hooks/useMyClinic';
import { useIsClinician } from '../hooks/useIsClinician';
import { listThreads, type ForumKind, type ForumThread, type ThreadSort } from '../lib/forum';
import { FORUM_PATH } from '../lib/forumRoutes';
import { useNoIndex } from '../hooks/useNoIndex';
import { ThreadCard, SpecialtySelect } from '../components/forum/ForumParts';
import { ThreadComposer } from '../components/forum/Composers';
import { ClinicianGate } from '../components/forum/ClinicianGate';
import { IconSearch, IconVerified, IconArrowRight } from '../components/icons/Icons';
import '../components/forum/forum.css';

/**
 * The list view of either forum: "Ask a Doctor" and "Med Society" (paths in
 * lib/forumRoutes.ts, currently unlisted). Same page, different audience — what changes between them is the
 * copy, who may post, and that Med Society is behind ClinicianGate.
 *
 * Filters live in the URL (?sort=&topic=&q=) so a "questions about braces
 * nobody has answered" view can be bookmarked or sent to a doctor.
 */
export function ForumPage({ forum }: { forum: ForumKind }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user, loading: sessionLoading } = useSession();
    // The gate asks the one cheap question; the listings themselves (needed
    // only to post) load alongside, not in front of, the threads.
    const { isClinician, loading: clinicianLoading } = useIsClinician(user?.id ?? null);
    const { owned } = useMyClinic(user?.id ?? null);
    const [params, setParams] = useSearchParams();

    const sort = (params.get('sort') === 'unanswered' ? 'unanswered' : 'recent') as ThreadSort;
    const topic = params.get('topic') ?? '';
    const urlQuery = params.get('q') ?? '';
    const [search, setSearch] = useState(urlQuery);
    const [composingState, setComposing] = useState(false);
    // Coming back from sign-up with ?compose=1 opens the form they wanted.
    const composing = composingState || (!!user && params.get('compose') === '1');

    const [threads, setThreads] = useState<ForumThread[]>([]);
    const [page, setPage] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    // Which request the current list answers; loading is "not this one yet".
    const [doneKey, setDoneKey] = useState('');
    const [failed, setFailed] = useState(false);

    const base = FORUM_PATH[forum];
    const k = forum === 'patients' ? 'ask' : 'society';
    useNoIndex();

    useEffect(() => {
        document.title = `${t(`forum.${k}.title`)} · MedSociety`;
    }, [t, k]);

    // Reset to page 0 whenever the filters change; append on later pages.
    const filterKey = `${forum}|${sort}|${topic}|${urlQuery}`;
    const [loadedKey, setLoadedKey] = useState('');
    if (loadedKey !== filterKey) {
        setLoadedKey(filterKey);
        setPage(0);
    }

    const requestKey = `${filterKey}|${page}`;
    const loading = doneKey !== requestKey;

    useEffect(() => {
        // Fetched without waiting on the clinician check: RLS returns nothing
        // from Med Society to anyone else, and the gate covers the page.
        let cancelled = false;
        void listThreads({ forum, sort, specialty: topic || null, query: urlQuery, page }).then((res) => {
            if (cancelled) return;
            setFailed(!!res.error);
            setThreads((prev) => (page === 0 ? res.threads : [...prev, ...res.threads]));
            setHasMore(res.hasMore);
            setDoneKey(requestKey);
        });
        return () => { cancelled = true; };
    }, [forum, sort, topic, urlQuery, page, requestKey]);

    const setParam = (key: string, value: string) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value); else next.delete(key);
        setParams(next, { replace: true });
    };

    if (forum === 'society' && (sessionLoading || clinicianLoading)) {
        return <main className="ms-page forum-page" id="main-content"><div className="forum-wrap"><div className="skeleton" style={{ height: 160, borderRadius: 'var(--radius)' }} /></div></main>;
    }
    if (forum === 'society' && !isClinician) {
        return <ClinicianGate signedIn={!!user} />;
    }

    const startComposing = () => {
        if (!user) {
            navigate(`/login?mode=signup&next=${encodeURIComponent(base + '?compose=1')}`);
            return;
        }
        setComposing(true);
    };

    return (
        <main className="ms-page forum-page" id="main-content">
            <div className="forum-wrap">
                <header className="forum-hero">
                    <p className="forum-eyebrow">{t(`forum.${k}.eyebrow`)}</p>
                    <h1 className="display">{t(`forum.${k}.title`)}</h1>
                    <p className="forum-lede">{t(`forum.${k}.lede`)}</p>
                    <div className="forum-hero-actions">
                        <button className="forum-btn press" onClick={startComposing}>
                            {t(`forum.${k}.cta`)}
                            <IconArrowRight size={15} weight={2} />
                        </button>
                        {forum === 'patients' && !isClinician && (
                            <Link to="/pricing" className="forum-btn-ghost press">{t('forum.ask.areYouDoctor')}</Link>
                        )}
                        {forum === 'society' && (
                            <Link to={`${FORUM_PATH.patients}?sort=unanswered`} className="forum-btn-ghost press">{t('forum.society.answerPatients')}</Link>
                        )}
                    </div>
                </header>

                {/* A doctor on the patient forum is the person we most want to
                    act; say what answering gets them, right where they can. */}
                {forum === 'patients' && isClinician && (
                    <div className="forum-banner">
                        <IconVerified size={20} />
                        <div>
                            <strong>{t('forum.ask.doctorBannerTitle')}</strong>
                            <p>{t('forum.ask.doctorBannerBody')}</p>
                        </div>
                        <button className="forum-btn-ghost press" onClick={() => setParam('sort', 'unanswered')}>
                            {t('forum.ask.doctorBannerCta')}
                        </button>
                    </div>
                )}

                {composing && (
                    <ThreadComposer
                        forum={forum}
                        clinics={owned}
                        onCancel={() => { setComposing(false); setParam('compose', ''); }}
                        onPosted={(id) => navigate(`${base}/${id}`)}
                    />
                )}

                <div className="forum-toolbar">
                    <div role="tablist" className="forum-tabs">
                        {(['recent', 'unanswered'] as ThreadSort[]).map((s) => (
                            <button
                                key={s}
                                role="tab"
                                aria-selected={sort === s}
                                onClick={() => setParam('sort', s === 'recent' ? '' : s)}
                            >
                                {t(`forum.${k}.sort.${s}`)}
                            </button>
                        ))}
                    </div>
                    <form
                        className="forum-search"
                        role="search"
                        onSubmit={(e) => { e.preventDefault(); setParam('q', search.trim()); }}
                    >
                        <IconSearch size={16} />
                        <input
                            type="search"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                if (!e.target.value) setParam('q', '');
                            }}
                            placeholder={t(`forum.${k}.search`)}
                            aria-label={t(`forum.${k}.search`)}
                        />
                    </form>
                    <SpecialtySelect value={topic} onChange={(v) => setParam('topic', v)} allLabel={t('forum.allTopics')} ariaLabel={t('forum.allTopics')} />
                </div>

                <div className="forum-list">
                    {threads.map((th) => <ThreadCard key={th.id} thread={th} to={`${base}/${th.id}`} />)}

                    {loading && threads.length === 0 && [0, 1, 2].map((i) => (
                        <div key={i} className="skeleton" style={{ height: 128, borderRadius: 'var(--radius)' }} />
                    ))}

                    {!loading && threads.length === 0 && (
                        <div className="forum-empty">
                            <p><strong>{failed ? t('forum.loadFailed') : t(`forum.${k}.empty`)}</strong></p>
                            {!failed && <p>{t(`forum.${k}.emptyBody`)}</p>}
                        </div>
                    )}

                    {hasMore && (
                        <button className="forum-btn-ghost press forum-more" disabled={loading} onClick={() => setPage((p) => p + 1)}>
                            {loading ? t('account.loading') : t('forum.loadMore')}
                        </button>
                    )}
                </div>

                {forum === 'patients' && <p className="forum-disclaimer">{t('forum.disclaimer')}</p>}
            </div>
        </main>
    );
}
