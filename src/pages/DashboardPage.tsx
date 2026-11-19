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
import { authButton } from '../components/account/authStyles';
import { ClinicProfileForm } from '../components/account/ClinicProfileForm';
import { ClinicPhotoManager } from '../components/account/ClinicPhotoManager';
import { ClinicPlanPanel } from '../components/account/ClinicPlanPanel';
import { ClinicSitePanel, type SiteRow } from '../components/account/ClinicSitePanel';
import { ClinicTeamPanel } from '../components/account/ClinicTeamPanel';
import { updatePractitionerLink } from '../lib/team';
import { StatsPanel, StatsSummary } from '../components/account/StatsPanel';
import { ClinicAvatar } from '../components/account/ClinicAvatar';
import { ProfileCompleteness } from '../components/account/ProfileCompleteness';
import { ToastProvider } from '../components/account/ToastProvider';
import { ForumDashCard } from '../components/forum/ForumPromos';
import { FORUMS_LISTED } from '../lib/forumRoutes';
import type { CompletenessTarget } from '../utils/profileCompleteness';
import { IconViews } from '../components/icons/Icons';

type Tab = 'overview' | 'insights' | 'profile' | 'photos' | 'website' | 'team' | 'plan';

/**
 * What a clinic can actually do once it has claimed a listing — which, until
 * now, was nothing.
 *
 * Single page with tabs rather than nested routes: there are a handful of panels, they
 * all operate on one listing, and giving each its own URL would mostly buy the
 * ability to deep-link into a form nobody links to.
 */
export function DashboardPage() {
    const { t } = useTranslation();
    const { user, loading: sessionLoading } = useSession();
    const { owned, access, pendingLinks, claims, loading, reload } = useMyClinic(user?.id ?? null);
    const location = useLocation();
    const [params] = useSearchParams();
    // The pricing page sends `?tab=plan&buy=<plan>`; the payment page sends the
    // customer back to `?tab=plan&paid=<plan>`. Read once, at mount.
    const [tab, setTab] = useState<Tab>(() => {
        const wanted = params.get('tab');
        return wanted === 'plan' || wanted === 'insights' || wanted === 'website' || wanted === 'team' ? wanted : 'overview';
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
    // The clinic's website, if it has one (a row in doctor_sites). The tab only exists then.
    const [siteState, setSiteState] = useState<{ id: string; row: SiteRow | null } | null>(null);
    const [siteNonce, setSiteNonce] = useState(0);
    const site = siteState && siteState.id === activeClinicId ? siteState.row : null;
    const reloadSite = () => setSiteNonce((n) => n + 1);
    useEffect(() => {
        if (!supabase || !activeClinicId) return;
        let live = true;
        void supabase.from('doctor_sites').select('subdomain, status, content').eq('provider_id', activeClinicId).maybeSingle()
            .then(({ data }) => { if (live) setSiteState({ id: activeClinicId, row: (data as SiteRow | null) ?? null }); });
        return () => { live = false; };
    }, [activeClinicId, siteNonce]);

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
        // The claim that most needs this person's attention decides the screen.
        const ORDER = ['needs_info', 'incomplete', 'pending', 'rejected'] as const;
        const claim = ORDER.map((s) => claims.find((c) => c.status === s)).find(Boolean);
        const copy = {
            needs_info: ['account.needsInfoTitle', 'account.needsInfoBody'],
            incomplete: ['account.incompleteTitle', 'account.incompleteBody'],
            pending: ['account.pendingTitle', 'account.pendingBody'],
            rejected: ['account.rejectedTitle', 'account.noClinicBody'],
        } as const;
        const [title, body] = claim ? copy[claim.status as keyof typeof copy] : ['account.noClinicTitle', 'account.noClinicBody'];
        return (
            <AuthShell title={t(title)} subtitle={t(body)}>
                {claim?.review_note && (claim.status === 'needs_info' || claim.status === 'rejected') && (
                    <p className="ms-claim-note warn" style={{ marginBottom: '1.25rem' }}>{claim.review_note}</p>
                )}
                {claim && claim.status !== 'rejected' && (
                    <Link to={`/claim/${claim.provider_id}`} className="press" style={{ ...authButton, textDecoration: 'none', marginBottom: '0.75rem' }}>
                        {t('account.openClaim')}
                    </Link>
                )}
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
    // A doctor's listing run on a clinic's behalf: the clinic edits the profile
    // and photos; insights, website, team and plan stay the doctor's.
    const managed = access[clinic.id] === 'managed';
    const switchTo = (id: string, nextTab?: Tab) => {
        if (tab === 'profile' && !confirmLeave()) return;
        dirtyRef.current = false;
        setActiveId(id);
        if (nextTab) setTab(nextTab);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const myPending = pendingLinks.filter((l) => l.practitioner_id === clinic.id);

    // Insights stays out of sight until the database says the listing has enough
    // traffic (`ready`: 30-day views past the threshold in stats_settings, or a
    // manual override). It appears by itself the moment that flips; a deep link to
    // it falls back to Overview until then.
    const insightsReady = Boolean(stats?.ready);
    const visibleTabs = (managed
        ? ['overview', 'profile', 'photos'] as Tab[]
        : (['overview', 'insights', 'profile', 'photos', 'website', 'team', 'plan'] as Tab[])
            .filter((key) => (key !== 'insights' || insightsReady) && (key !== 'website' || site !== null)));
    const activeTab: Tab = visibleTabs.includes(tab) ? tab : 'overview';

    return (
        <ToastProvider>
        <AuthShell wide title={clinic.name} subtitle={t('account.dashboardSubtitle')}>
            {/* Most clinics own one listing; a group owns several. The picker
                only earns its space in the second case. */}
            {owned.length > 1 && (
                <select
                    value={clinic.id}
                    onChange={(e) => switchTo(e.target.value)}
                    style={{ marginBottom: '1.25rem' }}
                    aria-label={t('account.switchClinic')}
                >
                    {owned.map((p) => (
                        <option key={p.id} value={p.id}>
                            {access[p.id] === 'managed' ? `${p.name} · ${t('team.pickerSpecialist')}` : p.name}
                        </option>
                    ))}
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

            {managed && <p className="acct-muted acct-banner">{t('team.managedBanner')}</p>}

            {/* A clinic asked to list this doctor: answer here, not only in the Team tab. */}
            {myPending.map((l) => (
                <div key={l.clinic_id} className="acct-banner acct-row" role="status">
                    <span style={{ flex: '1 1 240px' }}>{t('team.pendingBanner', { clinic: l.clinic_name, city: l.clinic_city ?? '' })}</span>
                    <button type="button" className="acct-btn acct-btn--sm"
                        onClick={() => void updatePractitionerLink(l.clinic_id, clinic.id, { accept: true }).then(() => reload())}>
                        {t('team.accept')}
                    </button>
                    <button type="button" className="acct-link"
                        onClick={() => void updatePractitionerLink(l.clinic_id, clinic.id, { accept: false }).then(() => reload())}>
                        {t('team.decline')}
                    </button>
                </div>
            ))}

            <div
                role="tablist"
                style={{
                    display: 'flex', gap: '0.3rem', marginBottom: '1.6rem',
                    borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
                }}
            >
                {visibleTabs.map((key) => (
                    <button
                        key={key}
                        role="tab"
                        aria-selected={activeTab === key}
                        onClick={() => goTab(key)}
                        style={{
                            background: 'none',
                            padding: '0.6rem 0.85rem',
                            fontWeight: 700,
                            fontSize: '0.88rem',
                            color: activeTab === key ? 'var(--white)' : 'var(--gray-500)',
                            borderBottom: `2px solid ${activeTab === key ? 'var(--accent)' : 'transparent'}`,
                            marginBottom: '-1px',
                        }}
                    >
                        {t(`account.tab.${key}`)}
                    </button>
                ))}
            </div>

            {activeTab === 'overview' && (
                <Overview
                    clinic={clinic}
                    galleryCount={galleryCount}
                    onGo={goTo}
                    stats={stats}
                    statsLoading={statsLoading}
                    onSeeInsights={() => goTab('insights')}
                />
            )}
            {activeTab === 'insights' && (
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
            {activeTab === 'profile' && (
                <ClinicProfileForm key={clinic.id} clinic={clinic} onSaved={reload} onDirtyChange={setDirty} />
            )}
            {activeTab === 'photos' && (
                <ClinicPhotoManager
                    key={clinic.id}
                    clinic={clinic}
                    onCountChange={setGalleryCount}
                    onGoToProfile={() => goTo({ tab: 'profile', field: 'acct-avatar' })}
                />
            )}
            {activeTab === 'website' && site && (
                <ClinicSitePanel key={`${clinic.id}:${siteNonce}`} clinic={clinic} site={site} onSaved={reloadSite} onEditProfile={(field) => goTo({ tab: 'profile', field })} />
            )}
            {activeTab === 'team' && (
                <ClinicTeamPanel
                    key={clinic.id}
                    clinic={clinic}
                    onChanged={() => { void reload(); }}
                    onEdit={(id) => switchTo(id, 'profile')}
                />
            )}
            {activeTab === 'plan' && (
                <ClinicPlanPanel
                    key={clinic.id}
                    clinic={clinic}
                    email={user?.email ?? ''}
                    onRefresh={reload}
                    highlight={planParam('buy')}
                    returnedFrom={planParam('paid')}
                    fromPortal={params.get('portal') === '1'}
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
