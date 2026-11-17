import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { formatPrice } from '../../utils/currency';
import { ServiceList } from './ServiceList';
import { IconMapPin, IconPhone, IconGlobe } from '../icons/Icons';
import { SOCIAL_ICONS, SOCIAL_ORDER } from '../icons/socialMap';

/** The map is the heaviest thing on a provider profile — never pay for it before it scrolls into view. */
const ProviderMap = lazy(() =>
    import('../map/ProviderMap').then((m) => ({ default: m.ProviderMap })),
);

/**
 * The sidebar card every profile has, clinic or doctor: address, phone,
 * e-mail, call, website, directions, socials, prices and services, the map.
 */
export function ContactCard({ provider }: { provider: Provider }) {
    const { t, i18n } = useTranslation();
    const hasCoords = Number.isFinite(provider.lat) && Number.isFinite(provider.lng);
    const directionsUrl = hasCoords
        ? `https://www.google.com/maps/dir/?api=1&destination=${provider.lat},${provider.lng}`
            + (provider.googlePlaceId ? `&destination_place_id=${encodeURIComponent(provider.googlePlaceId)}` : '')
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(provider.address)}`;

    return (
        <div
            data-section="contact"
            style={{
                background: 'var(--navy-800)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '1.25rem',
                display: 'flex', flexDirection: 'column', gap: '0.9rem',
                boxShadow: 'var(--shadow-sm)',
            }}
        >
            <h2 style={{
                fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--gray-500)', margin: 0,
            }}>
                {t('providerPage.contact')}
            </h2>

            <DetailRow icon={<IconMapPin size={17} />} text={provider.address} />
            {provider.postalCode && (
                <p style={{ fontSize: '0.82rem', color: 'var(--gray-500)', marginTop: '-0.5rem', marginLeft: '1.55rem' }}>
                    {provider.city}, {provider.country} · {provider.postalCode}
                </p>
            )}
            {provider.phone && (
                <DetailRow icon={<IconPhone size={17} />} text={provider.phone} href={`tel:${provider.phone}`} />
            )}
            {provider.email && (
                <DetailRow icon={<IconGlobe size={17} />} text={provider.email} href={`mailto:${provider.email}`} />
            )}

            {provider.phone && (
                <a
                    href={`tel:${provider.phone}`}
                    className="press"
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                        padding: '0.9rem 1rem', borderRadius: 'var(--radius)',
                        background: 'var(--brand)', color: 'var(--on-brand)',
                        fontWeight: 700, fontSize: '0.92rem', textDecoration: 'none',
                    }}
                >
                    <IconPhone size={17} weight={2} /> {t('drawer.callNow')}
                </a>
            )}

            {provider.website && (
                <a
                    href={provider.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="press"
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                        padding: '0.8rem 1rem', borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)', background: 'transparent',
                        color: 'var(--text)', fontWeight: 650, fontSize: '0.9rem', textDecoration: 'none',
                    }}
                >
                    <IconGlobe size={16} weight={2} /> {t('providerPage.website')}
                </a>
            )}

            <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="press"
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    padding: '0.8rem 1rem', borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', background: 'transparent',
                    color: 'var(--text)', fontWeight: 650, fontSize: '0.9rem', textDecoration: 'none',
                }}
            >
                <IconMapPin size={16} weight={2} /> {t('providerPage.getDirections')}
            </a>

            <SocialLinks socials={provider.socials} name={provider.name} />

            {(provider.priceFromMxn != null || (provider.services?.length ?? 0) > 0) && (
                <div data-section="services" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', borderTop: '1px solid var(--border)', paddingTop: '0.9rem' }}>
                    {provider.priceFromMxn != null && (
                        <p style={{ fontSize: '0.9rem', margin: 0 }}>
                            <span style={{ color: 'var(--gray-400)' }}>{t('providerPage.pricesFrom')} </span>
                            <strong style={{ color: 'var(--gold)' }}>
                                {/* Machine-readable amount (always MXN as stored); the text is the localised display. */}
                                <data value={provider.priceFromMxn} data-currency="MXN" data-price-from="true">
                                    {formatPrice(provider.priceFromMxn, i18n.language)}
                                </data>
                            </strong>
                        </p>
                    )}
                    <ServiceList services={provider.services ?? []} />
                </div>
            )}

            <div data-section="map" style={{ height: 200, borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {hasCoords ? (
                    <Suspense fallback={<MapPlaceholder />}>
                        <ProviderMap
                            lat={provider.lat}
                            lng={provider.lng}
                            name={provider.name}
                            address={provider.address}
                            directionsUrl={directionsUrl}
                        />
                    </Suspense>
                ) : (
                    <MapPlaceholder />
                )}
            </div>
        </div>
    );
}

function MapPlaceholder() {
    return (
        <div style={{
            width: '100%', height: '100%', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', background: 'var(--surface)',
        }} />
    );
}

export function DetailRow({ icon, text, href, muted = false, external = false }: {
    icon: React.ReactNode; text: string; href?: string; muted?: boolean; external?: boolean;
}) {
    const content = (
        <div
            style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.65rem',
                fontSize: '0.9rem', lineHeight: 1.5,
                color: href ? 'var(--gold)' : muted ? 'var(--gray-500)' : 'var(--gray-300)',
                fontWeight: href ? 600 : 400,
                fontStyle: muted ? 'italic' : 'normal',
            }}
        >
            <span style={{ flexShrink: 0, marginTop: 1, color: 'var(--gray-500)', display: 'flex' }}>{icon}</span>
            <span style={{ wordBreak: 'break-word' }}>{text}</span>
        </div>
    );

    if (!href) return content;
    return (
        <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
            {content}
        </a>
    );
}

/** Icon buttons for whichever social profiles are known; renders nothing when none are. */
function SocialLinks({ socials, name }: { socials?: Provider['socials']; name: string }) {
    const { t } = useTranslation();
    const entries = SOCIAL_ORDER.filter((k) => /^https?:\/\//i.test(socials?.[k] ?? ''));
    if (entries.length === 0) return null;
    return (
        <div className="ms-socials" role="group" aria-label={t('providerPage.socials.group', { name })}>
            {entries.map((k) => {
                const Icon = SOCIAL_ICONS[k];
                const label = t(`providerPage.socials.${k}`, { name });
                return (
                    <a
                        key={k}
                        href={socials![k]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ms-social-btn press"
                        aria-label={label}
                        title={label}
                    >
                        <Icon size={18} />
                    </a>
                );
            })}
        </div>
    );
}
