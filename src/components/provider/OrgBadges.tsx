import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderBadge } from '../../types/provider';
import { badgeLink, cardRow, GROUPS, groupOf, idOf, monogram } from '../../utils/orgBadges';
import './orgBadges.css';

function Tile({ badge, on, onToggle }: { badge: ProviderBadge; on: boolean; onToggle: () => void }) {
    const [broken, setBroken] = useState(false);
    return (
        <button
            type="button"
            className={`ms-orgtile is-${groupOf(badge)}${on ? ' is-on' : ''}`}
            aria-label={badge.label && badge.label !== badge.name ? `${badge.name}: ${badge.label}` : badge.name}
            aria-pressed={on}
            // A card is one big link: a tile opens its details, not the profile.
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
        >
            {badge.logo && !broken ? <img src={badge.logo} alt="" loading="lazy" onError={() => setBroken(true)} /> : monogram(badge.name)}
        </button>
    );
}

function Detail({ badge }: { badge: ProviderBadge }) {
    const { t, i18n } = useTranslation();
    const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }) : null);
    const link = badgeLink(badge);
    const rows: [string, string | null | undefined][] = [
        [t('badges.type'), t(`badges.group.${groupOf(badge)}`)],
        [t('badges.consejo'), badge.facts?.consejo],
        [t('badges.certificate'), badge.facts?.certificate],
        [t('badges.register'), badge.facts?.register],
        [t('badges.verifiedOn'), day(badge.confirmed_at)],
        [t('badges.validFrom'), day(badge.valid_from)],
        [t('badges.validTo'), badge.valid_to ? day(badge.valid_to) : t('badges.rechecked')],
    ];
    return (
        <div className="ms-orgdetail" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <strong>{badge.label || badge.name}</strong>
            {badge.label && badge.label !== badge.name && <span className="ms-orgdetail-org">{badge.name}</span>}
            <dl>
                {rows.filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
            </dl>
            {link && <a href={link.href} target="_blank" rel="noopener noreferrer">{link.kind === 'source' ? t('badges.source') : t('badges.about', { name: badge.name })} ↗</a>}
        </div>
    );
}

function Grouped({ badges, open, toggle }: { badges: ProviderBadge[]; open: string | null; toggle: (id: string) => void }) {
    const { t } = useTranslation();
    return (
        <>
            {GROUPS.filter((g) => badges.some((b) => groupOf(b) === g)).map((g) => (
                <div key={g} className={`ms-orggroup is-${g}`}>
                    <h4>{t(`badges.groups.${g}`)}</h4>
                    <div className="ms-orgrow">
                        {badges.filter((b) => groupOf(b) === g).map((b) => (
                            <Tile key={idOf(b)} badge={b} on={open === idOf(b)} onToggle={() => toggle(idOf(b))} />
                        ))}
                    </div>
                </div>
            ))}
        </>
    );
}

/** The logo row on a search card: what was verified, a separator, two affiliations, then "+N". */
export function CardBadges({ badges }: { badges?: ProviderBadge[] }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    if (!badges?.length) return null;

    const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
    const { verified, shown, hidden } = cardRow(badges);
    const current = badges.find((b) => idOf(b) === open);

    return (
        <div className="ms-orgbadges">
            {expanded ? <Grouped badges={badges} open={open} toggle={toggle} /> : (
                <div className="ms-orgrow">
                    {verified.map((b) => <Tile key={idOf(b)} badge={b} on={open === idOf(b)} onToggle={() => toggle(idOf(b))} />)}
                    {verified.length > 0 && shown.length > 0 && <span className="ms-orgsep" aria-hidden="true" />}
                    {shown.map((b) => <Tile key={idOf(b)} badge={b} on={open === idOf(b)} onToggle={() => toggle(idOf(b))} />)}
                    {hidden > 0 && (
                        <button type="button" className="ms-orgmore" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(true); }}>
                            {t('badges.more', { count: hidden })}
                        </button>
                    )}
                </div>
            )}
            {current && <Detail badge={current} />}
        </div>
    );
}

/** Every badge on a profile, grouped, with the details of the one selected. */
export function ProfileBadges({ badges }: { badges?: ProviderBadge[] }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState<string | null>(null);
    if (!badges?.length) return null;
    const current = badges.find((b) => idOf(b) === open) ?? null;
    return (
        <section className="ms-orgbadges is-profile" aria-label={t('badges.title')}>
            <h3>{t('badges.title')}</h3>
            <Grouped badges={badges} open={open} toggle={(id) => setOpen((o) => (o === id ? null : id))} />
            {current && <Detail badge={current} />}
        </section>
    );
}
