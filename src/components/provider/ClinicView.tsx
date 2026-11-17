import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider, Specialty } from '../../types/provider';
import type { TeamDoctor } from '../../hooks/useProviderTeam';
import type { FocusArea } from '../../utils/clinicFocus';
import { hueOf, portraitUrlSized } from '../../utils/images';
import { CardBadges } from './OrgBadges';
import { IconStar, SpecialtyIcon } from '../icons/Icons';

/**
 * The main column of a clinic's page. A clinic is a place with several
 * doctors and several focuses, so it leads with those: what it treats, who
 * practises there (each linking to their own profile), then the message form
 * with a "which doctor" choice, what its doctors offer, and the photos,
 * insurance and reviews every profile has.
 */
export function ClinicMain({ provider, doctors, focus, loading, children }: {
    provider: Provider;
    doctors: TeamDoctor[];
    focus: FocusArea[];
    loading: boolean;
    children: { photos: ReactNode; insurance: ReactNode; inquiry: ReactNode; reviews: ReactNode };
}) {
    const { t } = useTranslation();
    const [only, setOnly] = useState<Specialty | null>(null);
    const label = (s: string) => t(`specialties.${s}`, { defaultValue: s });

    const shown = only ? doctors.filter((d) => d.specialty.includes(only)) : doctors;
    // One grid, ordered by specialty, while it fits on a screen or two (each card names its
    // specialty, and the chips filter). A big roster gets a heading per specialty; a filter
    // is already one group.
    const groups = useMemo(() => {
        const bySpecialty = (a: TeamDoctor, b: TeamDoctor) =>
            (a.specialty[0] ?? '').localeCompare(b.specialty[0] ?? '') || a.name.localeCompare(b.name);
        if (only || doctors.length <= 12) return [{ key: only, list: [...shown].sort(bySpecialty) }];
        const by = new Map<Specialty, TeamDoctor[]>();
        for (const d of shown) {
            const k = d.specialty[0] ?? 'general';
            by.set(k, [...(by.get(k) ?? []), d]);
        }
        return [...by].sort((a, b) => b[1].length - a[1].length).map(([key, list]) => ({ key, list }));
    }, [only, doctors.length, shown]);

    // What the doctors here offer, most common first; the clinic's own services stay in the sidebar.
    const treatments = useMemo(() => {
        const n = new Map<string, number>();
        for (const d of doctors) for (const s of new Set(d.serviceNames)) n.set(s, (n.get(s) ?? 0) + 1);
        return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
    }, [doctors]);
    const [allTreatments, setAllTreatments] = useState(false);

    return (
        <>
            {focus.length > 0 && (
                <section data-section="focus" className="ms-clinic-section" aria-labelledby="clinic-focus-title">
                    <h2 id="clinic-focus-title" className="ms-clinic-h2">{t('clinicPage.focusTitle')}</h2>
                    <div className="ms-clinic-chips" role="group" aria-label={t('clinicPage.focusFilter')}>
                        {doctors.length > 0 && (
                            <button type="button" className={`ms-clinic-chip${only === null ? ' is-on' : ''}`}
                                aria-pressed={only === null} onClick={() => setOnly(null)}>
                                {t('clinicPage.allDoctors')} <span>{doctors.length}</span>
                            </button>
                        )}
                        {focus.map((f) => (
                            f.count > 0 ? (
                                <button key={f.key} type="button" className={`ms-clinic-chip${only === f.key ? ' is-on' : ''}`}
                                    aria-pressed={only === f.key} onClick={() => setOnly(only === f.key ? null : f.key)}>
                                    <SpecialtyIcon specialty={f.key} size={14} /> {label(f.key)} <span>{f.count}</span>
                                </button>
                            ) : (
                                <span key={f.key} className="ms-clinic-chip is-static">
                                    <SpecialtyIcon specialty={f.key} size={14} /> {label(f.key)}
                                </span>
                            )
                        ))}
                    </div>
                </section>
            )}

            <section data-section="doctors" className="ms-clinic-section" aria-labelledby="clinic-doctors-title">
                <h2 id="clinic-doctors-title" className="ms-clinic-h2">
                    {t('clinicPage.doctorsTitle')}{doctors.length > 0 && <span className="ms-clinic-count"> {doctors.length}</span>}
                </h2>
                {loading && doctors.length === 0 ? (
                    <div className="ms-clinic-grid" aria-hidden="true">
                        {[0, 1, 2].map((i) => <div key={i} className="ms-clinic-doc is-skeleton" />)}
                    </div>
                ) : doctors.length === 0 ? (
                    <div className="ms-clinic-empty">
                        <p>{t('clinicPage.noDoctors')}</p>
                        {provider.tier === 'basic' && (
                            <Link to={`/claim/${provider.id}`}>{t('clinicPage.claimToAdd')}</Link>
                        )}
                    </div>
                ) : (
                    groups.map((g) => (
                        <div key={g.key ?? 'all'} className="ms-clinic-group">
                            {groups.length > 1 && g.key && <h3 className="ms-clinic-h3">{label(g.key)}</h3>}
                            <ul className="ms-clinic-grid">
                                {g.list.map((d) => <DoctorCard key={d.id} doctor={d} />)}
                            </ul>
                        </div>
                    ))
                )}
            </section>

            {children.inquiry}

            {treatments.length > 0 && (
                <section className="ms-clinic-section" aria-labelledby="clinic-treat-title">
                    <h2 id="clinic-treat-title" className="ms-clinic-h2">{t('clinicPage.treatmentsTitle')}</h2>
                    <ul className="ms-clinic-tags">
                        {(allTreatments ? treatments : treatments.slice(0, 18)).map((s) => <li key={s}>{s}</li>)}
                    </ul>
                    {treatments.length > 18 && (
                        <button type="button" className="ms-clinic-more" onClick={() => setAllTreatments((v) => !v)}>
                            {allTreatments ? t('clinicPage.showFewer') : t('clinicPage.showAll', { count: treatments.length })}
                        </button>
                    )}
                </section>
            )}

            {children.photos}
            {children.insurance}
            {children.reviews}
        </>
    );
}

function DoctorCard({ doctor }: { doctor: TeamDoctor }) {
    const { t } = useTranslation();
    const photo = portraitUrlSized(doctor.imageUrl ?? undefined, 'thumb');
    const initials = doctor.name.replace(/^(dr|dra|doctor|doctora)\.?\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();
    return (
        <li>
            <Link to={`/providers/${doctor.id}`} className="ms-clinic-doc press">
                <span className="ms-clinic-doc-photo ms-mono" style={{ ['--mono-h' as string]: `${hueOf(doctor.id)}deg` } as React.CSSProperties}>
                    {photo ? <img src={photo} alt="" loading="lazy" /> : initials}
                </span>
                <span className="ms-clinic-doc-text">
                    <strong>{doctor.name}</strong>
                    <span>{doctor.specialty.map((s) => t(`specialties.${s}`, { defaultValue: s })).join(' · ')}</span>
                    {(doctor.rating ?? 0) > 0 && (doctor.reviewCount ?? 0) > 0 && (
                        <span className="ms-clinic-doc-rating">
                            <IconStar size={12} filled style={{ color: 'var(--star)' }} /> {(doctor.rating ?? 0).toFixed(1)}
                            <span> ({doctor.reviewCount})</span>
                        </span>
                    )}
                    <CardBadges badges={doctor.badges} />
                </span>
            </Link>
        </li>
    );
}
