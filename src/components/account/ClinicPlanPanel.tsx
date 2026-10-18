import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { fetchPlanStatus, startCheckout, type PlanKey, type PlanStatusRow } from '../../lib/billing';
import { IconCheck, IconVerified, IconPromoted, IconChart, IconLock } from '../icons/Icons';

/**
 * What this listing's plan includes, what it does not, and how to change that.
 *
 * The locked rows are shown rather than hidden. A free tier that cannot see
 * what the paid one buys has to upgrade on faith, and the three things in that
 * list — the Verified badge, the promoted pin, real analytics — are exactly
 * the things the last review decided should be worth paying for. Hiding them
 * would undo that.
 *
 * Subscribing opens the payment page for the clinic being viewed. Nothing here
 * unlocks anything: the plan switches on when the payment reaches
 * api/billing.ts, and this panel only waits for `clinic.tier` to change.
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
// What each language's payment link actually charges (lib/billing.ts): USD in English, MXN in Spanish.
const PRICE = {
    en: { promoted: '$49', featured: '$99' },
    es: { promoted: '$899', featured: '$1,799' },
} as const;

/** After a payment: check every 4 s for up to ~2 min for the plan to switch on. */
const POLL_MS = 4000;
const POLL_MAX = 30;

interface Props {
    clinic: Provider;
    /** The signed-in account's email, pre-filled on the payment page. */
    email: string;
    /** Re-reads the clinic so a freshly activated tier shows up. */
    onRefresh: () => void | Promise<void>;
    /** Plan the visitor asked for on the pricing page, highlighted here. */
    highlight?: PlanKey | null;
    /** Set when returning from the payment page. */
    returnedFrom?: PlanKey | null;
}

export function ClinicPlanPanel({ clinic, email, onRefresh, highlight, returnedFrom }: Props) {
    const { t, i18n } = useTranslation();
    const [busy, setBusy] = useState<PlanKey | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<PlanStatusRow[]>([]);
    const [gaveUp, setGaveUp] = useState(false);
    const rank = RANK[clinic.tier];
    const english = i18n.language.startsWith('en');

    // Latest refresh callback without restarting the poll every render.
    const refreshRef = useRef(onRefresh);
    useEffect(() => { refreshRef.current = onRefresh; });

    useEffect(() => {
        let cancelled = false;
        void fetchPlanStatus(clinic.id).then((rows) => { if (!cancelled) setStatus(rows); });
        return () => { cancelled = true; };
    }, [clinic.id, clinic.tier]);

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

    const subscribe = async (plan: PlanKey) => {
        setBusy(plan);
        setError(null);
        try {
            const url = await startCheckout(clinic.id, plan, i18n.language, email);
            window.location.assign(url);
        } catch {
            setError(t('account.checkoutFailed'));
            setBusy(null);
        }
    };

    const current = status.find((s) => s.access && s.plan === clinic.tier) ?? status.find((s) => s.access);
    const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'long' }) : '');
    const offered = (['promoted', 'featured'] as const).filter((p) => RANK[p] > rank);
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
                    <p style={{ fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gray-500)' }}>
                        {t('account.choosePlan')}
                    </p>
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
                                    <span className="display" style={{ fontSize: '1.9rem' }}>{PRICE[english ? 'en' : 'es'][plan]}</span>{' '}
                                    <span style={{ fontSize: '0.85rem', color: 'var(--gray-400)' }}>
                                        {english ? t('pricing.perMonth') : t('pricing.perMonthMxn')}
                                    </span>
                                </p>
                                {!english && (
                                    <p style={{ fontSize: '0.78rem', color: 'var(--gray-500)' }}>{t(`pricing.${plan}Alt`)}</p>
                                )}
                                <button
                                    onClick={() => void subscribe(plan)}
                                    disabled={busy !== null}
                                    className="press"
                                    style={{
                                        marginTop: 'auto', padding: '0.8rem 1.2rem', borderRadius: 'var(--radius-pill)',
                                        background: 'var(--brand)', color: 'var(--on-brand)', border: 'none',
                                        fontWeight: 700, fontSize: '0.92rem',
                                        opacity: busy !== null ? 0.65 : 1, cursor: busy !== null ? 'progress' : 'pointer',
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

            {rank > 0 && (
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
