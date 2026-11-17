import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TeamClinic } from '../../hooks/useProviderTeam';
import { hueOf, portraitUrlSized } from '../../utils/images';

/** On a doctor's page: the clinics they practise at, each linking to its own page. */
export function PractisesAt({ clinics }: { clinics: TeamClinic[] }) {
    const { t } = useTranslation();
    return (
        <section className="ms-practises" aria-labelledby="practises-title" data-section="practises">
            <h2 id="practises-title">{t('clinicPage.practisesAt')}</h2>
            <ul>
                {clinics.map((c) => {
                    const photo = portraitUrlSized(c.imageUrl ?? undefined, 'thumb');
                    return (
                        <li key={c.id}>
                            <Link to={`/providers/${c.id}`} className="press">
                                <span className="ms-clinic-doc-photo ms-mono" style={{ ['--mono-h' as string]: `${hueOf(c.id)}deg` } as React.CSSProperties}>
                                    {photo ? <img src={photo} alt="" loading="lazy" /> : c.name.slice(0, 1).toUpperCase()}
                                </span>
                                <span className="ms-clinic-doc-text">
                                    <strong>{c.name}</strong>
                                    {c.city && <span>{c.city}</span>}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
