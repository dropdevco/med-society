import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../types/provider';
import { useSession } from '../hooks/useSession';
import { useMyClinic } from '../hooks/useMyClinic';
import { signOut } from '../lib/auth';
import type { PlanKey } from '../lib/billing';
import { supabase } from '../lib/supabase';
import { useProviderStats, type ProviderStats } from '../hooks/useProviderStats';
import { AuthShell } from '../components/account/AuthShell';
import { ClinicProfileForm } from '../components/account/ClinicProfileForm';
import { ClinicPhotoManager } from '../components/account/ClinicPhotoManager';
import { ClinicPlanPanel } from '../components/account/ClinicPlanPanel';
import { StatsPanel, StatsSummary } from '../components/account/StatsPanel';
import { ClinicAvatar } from '../components/account/ClinicAvatar';
import { ProfileCompleteness } from '../components/account/ProfileCompleteness';
import { ToastProvider } from '../components/account/ToastProvider';
import { ForumDashCard } from '../components/forum/ForumPromos';
import { FORUMS_LISTED } from '../lib/forumRoutes';
import type { CompletenessTarget } from '../utils/profileCompleteness';
import { IconViews } from '../components/icons/Icons';

type Tab = 'overview' | 'insights' | 'profile' | 'photos' | 'plan';

/**
 * What a clinic can actually do once it has claimed a listing — which, until
 * now, was nothing.
 *
 * Single page with tabs rather than nested routes: there are four panels, they
 * all operate on one listing, and giving each its own URL would mostly buy the
 * ability to deep-link into a form nobody links to.
 */
export function DashboardPage() {
    const { t } = useTranslation();
    const { user, loading: sessionLoading } = useSession();
    const { owned, claims, loading, reload } = useMyClinic(user?.id ?? null);
    const location = useLocation();
    const [params] = useSearchParams();
    // The pricing page sends `?tab=plan&buy=<plan>`; the payment page sends the
    // customer back to `?tab=plan&paid=<plan>`. Read once, at mount.
    const [tab, setTab] = useState<Tab>(() => {
        const wanted = params.get('tab');
        return wanted === 'plan' || wanted === 'insights' ? wanted : 'overview';
    });
    const planParam = (key: string): PlanKey | null => {
        const v = params.get(key);
        return v === 'promoted' || v === 'featured' ? v : null;
    };
    const [activeId, setActiveId] = useState<string | null>(null);
    const [galleryCount, setGalleryCount] = useState(0);
    // A field to scroll to and focus once the target tab has rendered. `n`
    // makes asking for the same field twice in a row still fire the effect.
    const [focusTarget, setFocusTarget] = useState<{ id: string; n: number } | null>(null);
    // The profile form reports unsaved edits here so leaving its tab (or
    // switching clinic) can ask first, without lifting the whole draft up.
    const dirtyRef = useRef(false);
    const setDirty = useCallback((d: boolean) => { dirtyRef.current = d; }, []);

    const activeClinicId = (owned.find((p) => p.id === activeId) ?? owned[0])?.id ?? null;
    // The listing's analytics, fetched once and shared by the Overview summary and the Insights tab.
    const { stats, loading: statsLoading, error: statsError } = useProviderStats(activeClinicId);

    useEffect(() => {
        if (!supabase || !activeClinicId) return;
        let cancelled = false;
        void supabase
            .from('provider_photos')
            .select('id', { count: 'exact', head: true })
            .eq('provider_id', activeClinicId)
            .then(({ count }) => { if (!cancelled) setGalleryCount(count ?? 0); });
        return () => { cancelled = true; };
    }, [activeClinicId]);

    useEffect(() => {
        if (!focusTarget) return;
        const id = window.setTimeout(() => {
            const el = document.getElementById(focusTarget.id);
            if (!el) return;
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.remove('acct-flash');
            void el.offsetWidth; // restart the animation if it is still running
            el.classList.add('acct-flash');
            const focusable = el.matches('input,textarea,button,select')
                ? el
                : el.querySelector<HTMLElement>('input,textarea,button,select');
            (focusable ?? el).focus({ preventScroll: true });
        }, 80);
        return () => window.clearTimeout(id);
    }, [focusTarget, tab]);

    const confirmLeave = () =>
        !dirtyRef.current || window.confirm(t('account.unsavedConfirm'));

    const goTab = (next: Tab) => {
        if (next === tab) return;
        if (tab === 'profile' && !confirmLeave()) return;
        dirtyRef.current = false;
        setTab(next);
    };

    const goTo = (target: CompletenessTarget) => {
        if (target.tab !== tab && tab === 'profile' && !confirmLeave()) return;
        if (target.tab !== tab) dirtyRef.current = false;
        setTab(target.tab);
        if (target.field) setFocusTarget((prev) => ({ id: target.field!, n: (prev?.n ?? 0) + 1 }));
    };

    if (!sessionLoading && !user) {
        // Keep the query: someone sent here to buy a plan should land back on it.
        return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    }

    // `loading` flips true on every reload (after a save); only the first load
    // should replace the page, or an unsaved form would be torn down under the user.
    if (sessionLoading || (loading && owned.length === 0 && claims.length === 0)) {
        return <AuthShell title={t('account.loading')} />;
    }

    // Claimed but not yet approved, or nothing at all. Both are "there is
    // nothing to manage here yet", and both need to say what happens next.
    if (owned.length === 0) {
        const pending = claims.filter((c) => c.status === 'pending');
        return (
            <AuthShell
                title={pending.length > 0 ? t('account.pendingTitle') : t('account.noClinicTitle')}
                subtitle={pending.length > 0 ? t('account.pendingBody') : t('account.noClinicBody')}
            >
                <Link
                    to="/"
                    className="press"
                    style={{
                        display: 'block', textAlign: 'center', padding: '0.85rem 1.5rem',
                        borderRadius: 'var(--radius-pill)', background: 'var(--brand)',
                        color: 'var(--on-brand)', fontWeight: 700, textDecoration: 'none',
                    }}
                >
                    {t('account.findYourClinic')}
                </Link>
                <SignOutRow />
            </AuthShell>
        );
    }

    const clinic = owned.find((p) => p.id === activeId) ?? owned[0];

    return (
        <ToastProvider>
        <AuthShell wide title={clinic.name} subtitle={t('account.dashboardSubtitle')}>
            {/* Most clinics own one listing; a group owns several. The picker
                only earns its space in the second case. */}
            {owned.length > 1 && (
                <select
                    value={clinic.id}
                    onChange={(e) => {
                        if (tab === 'profile' && !confirmLeave()) return;
                        dirtyRef.current = false;
                        setActiveId(e.target.value);
                    }}
                    style={{ marginBottom: '1.25rem' }}
                    aria-label={t('account.switchClinic')}
                >
                    {owned.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            )}

            <div className="acct-header">
                <button
                    type="button"
                    className="acct-header-avatar"
                    onClick={() => goTo({ tab: 'profile', field: 'acct-avatar' })}
                    aria-label={t('account.avatarChange')}
                    title={t('account.avatarChange')}
                >
                    <ClinicAvatar src={clinic.imageUrl} name={clinic.name} size={52} />
                </button>
                <div className="acct-header-text">
                    <strong>{clinic.name}</strong>
                    <span>{clinic.city}</span>
                </div>
                <Link to={`/providers/${clinic.id}`} className="press acct-viewpublic">
                    <IconViews size={15} />
                    {t('account.viewPublic')}
                </Link>
            </div>

            <div
                role="tablist"
                style={{
                    display: 'flex', gap: '0.3rem', marginBottom: '1.6rem',
                    borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
                }}
            >
                {(['overview', 'insights', 'profile', 'photos', 'plan'] as Tab[]).map((key) => (
                    <button
                        key={key}
                        role="tab"
                        aria-selected={tab === key}
                        onClick={() => goTab(key)}
                        style={{
                            background: 'none',
                            padding: '0.6rem 0.85rem',
                            fontWeight: 700,
                            fontSize: '0.88rem',
                            color: tab === key ? 'var(--white)' : 'var(--gray-500)',
                            borderBottom: `2px solid ${tab === key ? 'var(--accent)' : 'transparent'}`,
                            marginBottom: '-1px',
                        }}
                    >
                        {t(`account.tab.${key}`)}
                    </button>
                ))}
            </div>

            {tab === 'overview' && (
                <Overview
                    clinic={clinic}
                    galleryCount={galleryCount}
                    onGo={goTo}
                    stats={stats}
                    statsLoading={statsLoading}
                    onSeeInsights={() => goTab('insights')}
                />
            )}
            {tab === 'insights' && (
                <StatsPanel
                    key={clinic.id}
                    clinic={clinic}
                    stats={stats}
                    loading={statsLoading}
                    error={statsError}
                    galleryCount={galleryCount}
                    onGo={goTo}
                    onSeePlans={() => goTab('plan')}
                />
            )}
            {tab === 'profile' && (
                <ClinicProfileForm key={clinic.id} clinic={clinic} onSaved={reload} onDirtyChange={setDirty} />
            )}
            {tab === 'photos' && (
                <ClinicPhotoManager
                    key={clinic.id}
                    clinic={clinic}
                    onCountChange={setGalleryCount}
                    onGoToProfile={() => goTo({ tab: 'profile', field: 'acct-avatar' })}
                />
            )}
            {tab === 'plan' && (
                <ClinicPlanPanel
                    key={clinic.id}
                    clinic={clinic}
                    email={user?.email ?? ''}
                    onRefresh={reload}
                    highlight={planParam('buy')}
                    returnedFrom={planParam('paid')}
                />
            )}

            <SignOutRow />
        </AuthShell>
        </ToastProvider>
    );
}

function Overview({ clinic, galleryCount, onGo, stats, statsLoading, onSeeInsights }: {
    clinic: Provider;
    galleryCount: number;
    onGo: (target: CompletenessTarget) => void;
    stats: ProviderStats | null;
    statsLoading: boolean;
    onSeeInsights: () => void;
}) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <ProfileCompleteness clinic={clinic} galleryCount={galleryCount} onGo={onGo} />
            {FORUMS_LISTED && <ForumDashCard specialties={clinic.specialty ?? []} />}
            {/*
              Measured traffic only. Until a listing has enough of it the numbers
              read "collecting data" instead of falling back to a modelled
              estimate: a figure a clinic later finds out was invented costs more
              trust than an empty tile ever could.
            */}
            <StatsSummary clinic={clinic} stats={stats} loading={statsLoading} onSeeInsights={onSeeInsights} />
        </div>
    );
}

function SignOutRow() {
    const { t } = useTranslation();
    return (
        <p style={{ marginTop: '2rem', textAlign: 'center' }}>
            <button
                onClick={() => { void signOut(); }}
                style={{ background: 'none', color: 'var(--gray-500)', fontSize: '0.84rem', textDecoration: 'underline' }}
            >
                {t('account.signOut')}
            </button>
        </p>
    );
}
