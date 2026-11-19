import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { track } from '../../lib/posthog';
import { BillingError, fetchPlanStatus, openPortal, readSavedMarket, saveChosenMarket, marketForLanguage, startCheckout, type Market, type PlanKey, type PlanStatusRow } from '../../lib/billing';
import { IconCheck, IconVerified, IconPromoted, IconChart, IconLock } from '../icons/Icons';
import { CurrencyPicker } from './CurrencyPicker';

/**
 * What this listing's plan includes, what it does not, and how to change that.
 *
 * The locked rows are shown rather than hidden. A free tier that cannot see
 * what the paid one buys has to upgrade on faith, and the three things in that
 * list — the Verified badge, the promoted pin, real analytics — are exactly
 * the things the last review decided should be worth paying for. Hiding them
 * would undo that.
 *
 * Subscribing opens Stripe Checkout for the clinic being viewed. Nothing here
 * unlocks anything: the plan switches on when Stripe reports the invoice paid
 * to api/billing.ts, and this panel only waits for `clinic.tier` to change.
 * A clinic that already pays never gets a second Subscribe button (that would
 * be a second subscription): it manages its plan in Stripe's customer portal,
 * where it can switch plan, update its card or cancel on its own.
 */
const FEATURES = [
    { key: 'listing', tier: 'basic', icon: <IconCheck size={15} weight={2.2} /> },
    { key: 'manage', tier: 'basic', icon: <IconCheck size={15} weight={2.2} /> },
    { key: 'whatsapp', tier: 'basic', icon: <IconCheck size={15} weight={2.2} /> },
    { key: 'badge', tier: 'promoted', icon: <IconVerified size={15} weight={2} /> },
    { key: 'pin', tier: 'promoted', icon: <IconPromoted size={15} weight={2} /> },
    { key: 'newsletter', tier: 'promoted', icon: <IconPromoted size={15} weight={2} /> },
    { key: 'analytics', tier: 'featured', icon: <IconChart size={15} weight={2} /> },
    { key: 'top', tier: 'featured', icon: <IconChart size={15} weight={2} /> },
] as const;

const RANK = { basic: 0, promoted: 1, featured: 2 } as const;
// What each market's Stripe price charges: USD in us, MXN in mx. Keep in step with the prices in Stripe.
const PRICE: Record<Market, Record<PlanKey, string>> = {
    us: { promoted: '$49', featured: '$99' },
    mx: { promoted: '$899', featured: '$1,799' },
};

/** After a payment: check every 4 s for up to ~2 min for the plan to switch on. */
const POLL_MS = 4000;
const POLL_MAX = 30;
/** After the portal: re-read every 3 s for 30 s. */
const PORTAL_POLL_MS = 3000;
const PORTAL_POLLS = 10;

interface Props {
    clinic: Provider;
    /** The signed-in account's email, shown beside the payment note. */
    email: string;
    /** Re-reads the clinic so a freshly activated tier shows up. */
    onRefresh: () => void | Promise<void>;
    /** Plan the visitor asked for on the pricing page, highlighted here. */
    highlight?: PlanKey | null;
    /** Set when returning from the payment page. */
    returnedFrom?: PlanKey | null;
    /** Set when returning from Stripe's customer portal, where the plan may just have changed. */
    fromPortal?: boolean;
}

export function ClinicPlanPanel({ clinic, email, onRefresh, highlight, returnedFrom, fromPortal }: Props) {
    const { t, i18n } = useTranslation();
    const [busy, setBusy] = useState<PlanKey | 'portal' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<PlanStatusRow[]>([]);
    const [gaveUp, setGaveUp] = useState(false);
    const [overrideMarket, setOverrideMarket] = useState<Market | null>(null);
    const [statusFor, setStatusFor] = useState<string | null>(null);
    // Bumped to re-read the plan status when the tier itself did not change (a cancel, a resume).
    const [statusNonce, setStatusNonce] = useState(0);
    const rank = RANK[clinic.tier];
    const statusKey = `${clinic.id}:${clinic.tier}`;
    const statusLoaded = statusFor === statusKey;

    // Latest refresh callback without restarting the poll every render.
    const refreshRef = useRef(onRefresh);
    useEffect(() => { refreshRef.current = onRefresh; });

    useEffect(() => {
        let cancelled = false;
        void fetchPlanStatus(clinic.id).then((rows) => {
            if (cancelled) return;
            setStatus(rows);
            setStatusFor(statusKey);
        });
        return () => { cancelled = true; };
    }, [clinic.id, statusKey, statusNonce]);

    // Back from the portal: Stripe's webhook lands a few seconds after the page
    // does, so re-read the listing and its plan for a short while.
    useEffect(() => {
        if (!fromPortal) return;
        let n = 0;
        const id = window.setInterval(() => {
            n += 1;
            void refreshRef.current();
            setStatusNonce((x) => x + 1);
            if (n >= PORTAL_POLLS) window.clearInterval(id);
        }, PORTAL_POLL_MS);
        return () => window.clearInterval(id);
    }, [fromPortal, clinic.id]);

    const handleMarketChange = (newMarket: Market) => {
        setOverrideMarket(newMarket);
        saveChosenMarket(newMarket);
    };

    // Back from the payment page: wait for the webhook to land and flip the tier.
    const waiting = Boolean(returnedFrom) && RANK[clinic.tier] < RANK[returnedFrom ?? 'promoted'];
    useEffect(() => {
        if (!waiting) return;
        let n = 0;
        const id = window.setInterval(() => {
            n += 1;
            if (n > POLL_MAX) {
                window.clearInterval(id);
                setGaveUp(true);
                return;
            }
            void refreshRef.current();
        }, POLL_MS);
        return () => window.clearInterval(id);
    }, [waiting, clinic.id]);

    // Pressing Back on the payment page restores this page from the browser's
    // cache exactly as it was left, button still busy. Nothing is in flight then.
    useEffect(() => {
        const onShow = (e: PageTransitionEvent) => { if (e.persisted) setBusy(null); };
        window.addEventListener('pageshow', onShow);
        return () => window.removeEventListener('pageshow', onShow);
    }, []);

    const current = status.find((s) => s.access && s.plan === clinic.tier) ?? status.find((s) => s.access);
    // Stripe refuses a second currency on a customer with an active subscription,
    // so an upgrade has to stay in the currency the current plan is billed in.
    const lockedMarket = current?.market ?? null;
    const market = lockedMarket ?? overrideMarket ?? readSavedMarket() ?? marketForLanguage(i18n.language);
    const blocked = busy !== null || !statusLoaded;
    // A plan that is being paid for: it is managed, not bought again.
    const paying = status.find((s) => s.access && (s.status === 'active' || s.status === 'canceled'));
    // Any Stripe history opens the portal, even after our records let the plan lapse: Stripe may
    // still be retrying the last charge, and the card is fixed there, not with a new subscription.
    const stripeManaged = status.some((s) => s.stripe);

    const billingErrorText = (e: unknown, fallback: string) => {
        const code = e instanceof BillingError ? e.code : '';
        if (code === 'already_subscribed') return t('account.alreadySubscribed');
        if (code === 'not_your_listing') return t('account.ownerOnlyBilling');
        return fallback;
    };

    const subscribe = async (plan: PlanKey) => {
        setBusy(plan);
        setError(null);
        track('checkout_started', { plan, provider_id: clinic.id, current_tier: clinic.tier, market });
        try {
            const url = await startCheckout(clinic.id, plan, market);
            window.location.assign(url);
        } catch (e) {
            track('checkout_failed', { plan, provider_id: clinic.id });
            setError(billingErrorText(e, t('account.checkoutFailed')));
            setBusy(null);
        }
    };

    const managePlan = async () => {
        setBusy('portal');
        setError(null);
        track('plan_portal_opened', { provider_id: clinic.id, current_tier: clinic.tier });
        try {
            window.location.assign(await openPortal(clinic.id));
        } catch (e) {
            setError(billingErrorText(e, t('account.portalFailed')));
            setBusy(null);
        }
    };

    const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'long' }) : '');
    const offered = paying ? [] : (['promoted', 'featured'] as const).filter((p) => RANK[p] > rank);
    const ended = rank === 0 && status.some((s) => s.status === 'lapsed' || s.status === 'refunded');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3rem' }}>
            {returnedFrom && (
                <p
                    role="status"
                    style={{
                        padding: '0.9rem 1.1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', lineHeight: 1.55,
                        background: 'var(--gold-dim)', border: '1px solid var(--gold)', color: 'var(--white)',
                    }}
                >
                    {!waiting
                        ? t('account.paidDone', { plan: t(`pricing.${clinic.tier}Tier`) })
                        : gaveUp ? t('account.paidSlow') : t('account.paidWaiting')}
                </p>
            )}

            <div
                style={{
                    padding: '1.1rem 1.2rem',
                    borderRadius: 'var(--radius)',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                }}
            >
                <p style={{ fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray-500)' }}>
                    {t('account.currentPlan')}
                </p>
                <p className="display" style={{ fontSize: '1.9rem', marginTop: '0.3rem' }}>
                    {t(`pricing.${clinic.tier}Tier`)}
                </p>
                {current && current.status !== 'comp' && current.paid_through && (
                    <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)', marginTop: '0.35rem' }}>
                        {current.status === 'canceled'
                            ? t('account.planCanceledUntil', { date: date(current.paid_through) })
                            : t('account.planActiveUntil', { date: date(current.paid_through) })}
                    </p>
                )}
                {ended && (
                    <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)', marginTop: '0.35rem' }}>{t('account.planEnded')}</p>
                )}
            </div>

            <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', listStyle: 'none' }}>
                {FEATURES.map((feature) => {
                    const locked = RANK[feature.tier] > rank;
                    return (
                        <li
                            key={feature.key}
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
                                fontSize: '0.9rem', lineHeight: 1.5,
                                color: locked ? 'var(--gray-500)' : 'var(--gray-200)',
                            }}
                        >
                            <span style={{ display: 'flex', marginTop: 2, flexShrink: 0, color: locked ? 'var(--gray-500)' : 'var(--accent)' }}>
                                {locked ? <IconLock size={15} weight={2} /> : feature.icon}
                            </span>
                            <span>{t(`account.plan.${feature.key}`)}</span>
                            {locked && (
                                <span
                                    style={{
                                        marginLeft: 'auto', flexShrink: 0,
                                        padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-pill)',
                                        background: 'var(--gold-dim)', color: 'var(--gold)',
                                        fontSize: '0.68rem', fontWeight: 800, whiteSpace: 'nowrap',
                                    }}
                                >
                                    {t(`pricing.${feature.tier}Tier`)}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>

            {offered.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
                        <p style={{ fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray-500)', margin: 0 }}>
                            {t('account.choosePlan')}
                        </p>
                        <CurrencyPicker value={market} onChange={handleMarketChange} disabled={!statusLoaded || lockedMarket !== null} />
                    </div>
                    {lockedMarket && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', lineHeight: 1.55 }}>
                            {t('account.currencyLocked', { currency: lockedMarket === 'us' ? 'USD' : 'MXN' })}
                        </p>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem' }}>
                        {offered.map((plan) => (
                            <div
                                key={plan}
                                style={{
                                    flex: '1 1 220px', padding: '1.1rem 1.2rem', borderRadius: 'var(--radius)',
                                    background: 'var(--navy-800)',
                                    border: `1px solid ${highlight === plan ? 'var(--gold)' : 'var(--border)'}`,
                                    display: 'flex', flexDirection: 'column', gap: '0.55rem',
                                }}
                            >
                                <p style={{ fontWeight: 800, fontSize: '1rem' }}>{t(`pricing.${plan}Tier`)}</p>
                                <p>
                                    <span className="display" style={{ fontSize: '1.9rem' }}>{PRICE[market][plan]}</span>{' '}
                                    <span style={{ fontSize: '0.85rem', color: 'var(--gray-400)' }}>
                                        {market === 'us' ? t('pricing.perMonthUsd') : t('pricing.perMonthMxn')}
                                    </span>
                                </p>
                                {market === 'mx' && (
                                    <p style={{ fontSize: '0.78rem', color: 'var(--gray-500)' }}>{t(`pricing.${plan}Alt`)}</p>
                                )}
                                <button
                                    onClick={() => void subscribe(plan)}
                                    disabled={blocked}
                                    className="press"
                                    style={{
                                        marginTop: 'auto', padding: '0.8rem 1.2rem', borderRadius: 'var(--radius-pill)',
                                        background: 'var(--brand)', color: 'var(--on-brand)', border: 'none',
                                        fontWeight: 700, fontSize: '0.92rem',
                                        opacity: blocked ? 0.65 : 1, cursor: blocked ? 'progress' : 'pointer',
                                    }}
                                >
                                    {busy === plan ? t('account.subscribeBusy') : t('account.subscribe')}
                                </button>
                            </div>
                        ))}
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', lineHeight: 1.55 }}>
                        {t('account.securePay', { email })}
                    </p>
                    {error && <p role="alert" style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{error}</p>}
                </div>
            )}

            {stripeManaged && (
                <div
                    style={{
                        padding: '1.1rem 1.2rem', borderRadius: 'var(--radius)', background: 'var(--navy-800)',
                        border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.7rem',
                    }}
                >
                    <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)', lineHeight: 1.55 }}>{t('account.manageHelp')}</p>
                    <button
                        onClick={() => void managePlan()}
                        disabled={blocked}
                        className="press"
                        style={{
                            alignSelf: 'flex-start', padding: '0.8rem 1.4rem', borderRadius: 'var(--radius-pill)',
                            background: 'var(--brand)', color: 'var(--on-brand)', border: 'none',
                            fontWeight: 700, fontSize: '0.92rem',
                            opacity: blocked ? 0.65 : 1, cursor: blocked ? 'progress' : 'pointer',
                        }}
                    >
                        {busy === 'portal' ? t('account.manageBusy') : t('account.managePlan')}
                    </button>
                    {error && <p role="alert" style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{error}</p>}
                </div>
            )}

            {rank > 0 && !stripeManaged && (
                <p style={{ fontSize: '0.82rem', color: 'var(--gray-500)', lineHeight: 1.55 }}>
                    {t('account.cancelHelp')}{' '}
                    <Link to="/contact" style={{ textDecoration: 'underline' }}>{t('contact.title')}</Link>
                </p>
            )}

            <p style={{ fontSize: '0.82rem', color: 'var(--gray-500)' }}>
                <Link to="/pricing" style={{ textDecoration: 'underline' }}>{t('account.seeAllPlans')}</Link>
            </p>
        </div>
    );
}
