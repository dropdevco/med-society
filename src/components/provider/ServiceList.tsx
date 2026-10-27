import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderService } from '../../types/provider';
import { formatPrice } from '../../utils/currency';

/** Show this many before collapsing behind a "+N more" toggle. */
const VISIBLE = 6;

/**
 * Services a practice publishes, with prices where it quotes them.
 *
 * Prices are list prices scraped from the provider's own profile, not quotes:
 * "Desde $1,000" means the visit starts there, and none of it accounts for
 * what an insurer covers. The disclaimer says so, because a patient who plans
 * around a number we showed them and then gets a different bill is a worse
 * outcome than one who never saw a number at all.
 */
/**
 * The price line for one service, in the site's language and currency.
 *
 * `priceText` is scraped verbatim ("Desde $1,000") and was rendered as-is,
 * which is why an English-language visitor still read the Spanish word
 * "Desde" — it was never a UI string, so `t()` never touched it. The
 * structured `priceMxn`/`isFrom` fields the backfill already parsed out of
 * that same text are what let this be rebuilt through i18n instead: a plain
 * amount, a "from X" wrapper, or "Free" for a zero price, all localised.
 * Every priced service in this directory is a Doctoralia listing, and
 * Doctoralia MX only ever quotes MXN — `formatPrice` is what turns that
 * single stored MXN number into "$88 USD" for an English reader or
 * "$1,500 MXN" for a Spanish one, so nobody has to guess which currency a
 * bare number means.
 *
 * Falls back to the raw scraped text only when `priceMxn` is null — a price
 * string our parser found no number in at all, which real data shows as
 * essentially never happening. That raw text is always the clinic's own
 * Spanish wording (e.g. "Desde $1,000") and is shown as-is even to an
 * English reader in this near-nonexistent case, since there is no structured
 * number here to convert or label.
 */
function priceLabel(
    s: ProviderService,
    lang: string,
    t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
    if (!s.priceText) return null;
    if (s.priceMxn == null) return s.priceText;
    if (s.priceMxn === 0) return t('drawer.serviceFree');
    const price = formatPrice(s.priceMxn, lang);
    return s.isFrom ? t('drawer.servicePriceFrom', { price }) : t('drawer.servicePrice', { price });
}

interface ServiceListProps {
    services: ProviderService[];
    /**
     * False on the provider page, which has the room to show every service up
     * front rather than behind a "+N more" toggle — the collapsed form exists
     * for the drawer's tight width, not because a long list is undesirable.
     * Defaults to true so every existing caller keeps today's behaviour.
     */
    collapsible?: boolean;
}

export function ServiceList({ services, collapsible = true }: ServiceListProps) {
    const { t, i18n } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    if (!services.length) return null;

    const shown = collapsible && !expanded ? services.slice(0, VISIBLE) : services;
    const hidden = services.length - shown.length;
    const anyPriced = services.some((s) => s.priceMxn != null);

    return (
        <section>
            <h3
                style={{
                    fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'var(--gray-500)',
                    margin: '0 0 0.65rem',
                }}
            >
                {t('drawer.services', { defaultValue: 'Services & prices' })}
            </h3>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                {shown.map((s, i) => (
                    <li
                        key={`${s.slug ?? s.name}-${i}`}
                        style={{
                            display: 'flex', alignItems: 'baseline', gap: '0.75rem',
                            padding: '0.45rem 0',
                            borderBottom: i < shown.length - 1 ? '1px solid var(--border)' : 'none',
                        }}
                    >
                        <span style={{ flex: 1, minWidth: 0, fontSize: '0.87rem', color: 'var(--text)' }}>
                            {/* nameEn exists only once the batch translation has
                                reached this service — see scripts/doctoralia/
                                translate-services.ts. Until then, or for a
                                Spanish-language visitor, the clinic's own
                                published name is exactly what should show. */}
                            {i18n.language.startsWith('en') && s.nameEn ? s.nameEn : s.name}
                        </span>
                        {priceLabel(s, i18n.language, t) && (
                            <span style={{
                                fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap',
                                color: s.priceMxn != null ? 'var(--white)' : 'var(--gray-500)',
                            }}>
                                {s.priceMxn != null ? (
                                    // Machine-readable amount (always MXN as stored); the text is the localised display.
                                    <data
                                        value={s.priceMxn}
                                        data-currency="MXN"
                                        data-price-from={s.isFrom ? 'true' : undefined}
                                    >
                                        {priceLabel(s, i18n.language, t)}
                                    </data>
                                ) : priceLabel(s, i18n.language, t)}
                            </span>
                        )}
                    </li>
                ))}
            </ul>

            {hidden > 0 && (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="press"
                    style={{
                        marginTop: '0.6rem',
                        fontSize: '0.8rem', fontWeight: 600,
                        padding: '0.3rem 0.6rem', borderRadius: '99px',
                        border: '1px dashed var(--border)', background: 'transparent',
                        color: 'var(--gray-500)', cursor: 'pointer',
                    }}
                >
                    {t('drawer.servicesMore', { count: hidden, defaultValue: `+${hidden} more` })}
                </button>
            )}

            {anyPriced && (
                <p style={{ margin: '0.6rem 0 0', fontSize: '0.7rem', color: 'var(--gray-500)', lineHeight: 1.5 }}>
                    {t('drawer.serviceDisclaimer', {
                        defaultValue: 'Prices are as published by the provider and may have changed. Confirm before booking.',
                    })}
                </p>
            )}
        </section>
    );
}
