import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderBadge } from '../../types/provider';
import './orgBadges.css';

type Group = 'credential' | 'affiliation' | 'facility';

const GROUP_OF: Record<ProviderBadge['kind'], Group> = {
    consejo: 'credential',
    hospital: 'affiliation',
    colegio: 'affiliation',
    association: 'affiliation',
    regulator: 'facility',
    accreditor: 'facility',
};
const GROUPS: Group[] = ['credential', 'affiliation', 'facility'];
const groupOf = (b: ProviderBadge) => GROUP_OF[b.kind] ?? 'affiliation';
const idOf = (b: ProviderBadge) => `${b.org}:${b.label}`;

/** Letters for an organization whose logo we may not show yet: "Star Médica" → SM, "CONACEM" → CON. */
function monogram(name: string): string {
    const words = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/\s+/).filter(Boolean);
    return words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
}

function Tile({ badge, on, onToggle }: { badge: ProviderBadge; on: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            className={`ms-orgtile is-${groupOf(badge)}${on ? ' is-on' : ''}`}
            aria-label={badge.label ? `${badge.name}: ${badge.label}` : badge.name}
            aria-pressed={on}
            // A card is one big link: a tile opens its details, not the profile.
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
        >
            {badge.logo ? <img src={badge.logo} alt="" loading="lazy" /> : monogram(badge.name)}
        </button>
    );
}

function Detail({ badge }: { badge: ProviderBadge }) {
    const { t, i18n } = useTranslation();
    const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }) : null);
    const rows: [string, string | null | undefined][] = [
        [t('badges.type'), t(`badges.group.${groupOf(badge)}`)],
        [t('badges.consejo'), badge.facts?.consejo],
        [t('badges.certificate'), badge.facts?.certificate],
        [t('badges.verifiedOn'), day(badge.confirmed_at)],
        [t('badges.validFrom'), day(badge.valid_from)],
        [t('badges.validTo'), badge.valid_to ? day(badge.valid_to) : t('badges.rechecked')],
    ];
    return (
        <div className="ms-orgdetail" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <strong>{badge.label || badge.name}</strong>
            {badge.label && <span className="ms-orgdetail-org">{badge.name}</span>}
            <dl>
                {rows.filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
            </dl>
            {badge.url && <a href={badge.url} target="_blank" rel="noopener noreferrer">{t('badges.source')} ↗</a>}
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

/** The logo row on a search card: credentials, a separator, two affiliations, then "+N". */
export function CardBadges({ badges }: { badges?: ProviderBadge[] }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    if (!badges?.length) return null;

    const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
    const credentials = badges.filter((b) => groupOf(b) === 'credential');
    const others = badges.filter((b) => groupOf(b) !== 'credential');
    const shown = others.slice(0, 2);
    const hidden = others.length - shown.length;
    const current = badges.find((b) => idOf(b) === open);

    return (
        <div className="ms-orgbadges">
            {expanded ? <Grouped badges={badges} open={open} toggle={toggle} /> : (
                <div className="ms-orgrow">
                    {credentials.map((b) => <Tile key={idOf(b)} badge={b} on={open === idOf(b)} onToggle={() => toggle(idOf(b))} />)}
                    {credentials.length > 0 && shown.length > 0 && <span className="ms-orgsep" aria-hidden="true" />}
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
