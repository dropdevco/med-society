import { useTranslation } from 'react-i18next';
import type { Provider, Specialty } from '../../types/provider';
import { specialtiesOf, type AiSearchResult } from '../../hooks/useAiSearch';
import { regionOf, type RegionId } from '../../utils/region';
import { ProviderCard } from '../provider/ProviderCard';
import { IconPhone, IconReviews, IconArrowRight } from '../icons/Icons';

interface AiMatchesProps {
    result: AiSearchResult | null;
    loading: boolean;
    /** Providers of the current region (the directory loads one region at a time). */
    providerById: Map<string, Provider>;
    /** The region the search ran in; doctors outside it are never shown. */
    region: RegionId;
    onSelect: (p: Provider) => void;
    onSpecialty: (s: Specialty) => void;
    distanceOf: (p: Provider) => number | undefined;
}

const QUOTE_MAX = 240;

/**
 * "Doctors who helped with something similar", above the ordinary results.
 *
 * Every quote is a patient's own words from the database, picked by the server
 * by id; nothing here is model-written except the one-line guidance, which is
 * labelled as such. Renders nothing for a query that is not a health concern.
 */
export function AiMatches({ result, loading, providerById, region, onSelect, onSpecialty, distanceOf }: AiMatchesProps) {
    const { t } = useTranslation();

    if (loading) {
        return (
            <section className="ms-ai" aria-busy="true" style={panel}>
                <p style={{ ...eyebrow, marginBottom: '0.6rem' }}>
                    <IconReviews size={14} /> {t('ai.title')}
                </p>
                <p style={{ color: 'var(--gray-400)', fontSize: '0.9rem' }}>{t('ai.loading')}</p>
                <div className="skeleton" style={{ height: 14, width: '70%', borderRadius: 6, marginTop: '0.75rem' }} />
            </section>
        );
    }
    if (!result || !result.isConcern) return null;

    if (result.emergency) {
        return (
            <section role="alert" style={{ ...panel, borderColor: 'var(--red)' }}>
                <p style={{ color: 'var(--red)', fontWeight: 700, fontSize: '1rem', marginBottom: '0.4rem' }}>
                    {t('ai.emergencyTitle')}
                </p>
                <p style={{ color: 'var(--white)', fontSize: '0.92rem', marginBottom: '0.9rem' }}>{result.guidance}</p>
                <a href="tel:911" className="press" style={{ ...button, background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }}>
                    <IconPhone size={15} /> {t('ai.call911')}
                </a>
            </section>
        );
    }

    const specialties = specialtiesOf(result);

    // Safety net behind the server's region filter: a doctor missing from the
    // loaded list (another region, or no longer live) is dropped silently, and
    // so is one whose region or coordinates place it elsewhere.
    const doctors = result.doctors
        .map((d) => ({ ...d, provider: providerById.get(d.providerId) }))
        .filter((d): d is typeof d & { provider: Provider } =>
            !!d.provider && (d.provider.region ?? regionOf(d.provider.lng)) === region);

    return (
        <section className="ms-ai" style={panel}>
            <p style={eyebrow}>
                <IconReviews size={14} /> {t('ai.title')}
            </p>
            {result.guidance && (
                <p style={{ color: 'var(--white)', fontSize: '0.95rem', lineHeight: 1.5, margin: '0.5rem 0 0.8rem' }}>
                    {result.guidance}
                </p>
            )}
            {specialties.length > 0 && (
                // One pill per kind of doctor the guidance names, so the text and
                // the buttons under it can never disagree.
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {specialties.map((s) => (
                        <button key={s} type="button" className="press" style={button} onClick={() => onSpecialty(s)}>
                            {t('ai.seeAll', { specialty: t(`specialties.${s}`, { defaultValue: s }) })}
                            <IconArrowRight size={14} />
                        </button>
                    ))}
                </div>
            )}

            {doctors.length > 0 ? (
                <>
                    <p style={{ ...eyebrow, marginTop: '1.25rem' }}>{t('ai.helpedSimilar')}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginTop: '0.6rem' }}>
                        {doctors.map((d) => (
                            <div key={d.providerId}>
                                <ProviderCard
                                    provider={d.provider}
                                    selected={false}
                                    onClick={onSelect}
                                    distance={distanceOf(d.provider)}
                                />
                                {d.quotes.map((q) => (
                                    <blockquote key={q.reviewId} style={quote}>
                                        “{q.body.length > QUOTE_MAX ? `${q.body.slice(0, QUOTE_MAX).trimEnd()}…` : q.body}”
                                        <span style={{ display: 'block', marginTop: '0.25rem', fontStyle: 'normal', fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                                            {t('ai.reviewSource')}
                                            {q.translated && q.sourceLang && ` · ${t(`ai.translatedFrom.${q.sourceLang}`)}`}
                                        </span>
                                    </blockquote>
                                ))}
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <p style={{ color: 'var(--gray-400)', fontSize: '0.85rem', marginTop: '0.9rem' }}>{t('ai.noMatches')}</p>
            )}

            <p style={{ color: 'var(--gray-400)', fontSize: '0.75rem', marginTop: '1rem', lineHeight: 1.45 }}>
                {t('ai.disclaimer')}
            </p>
        </section>
    );
}

const panel: React.CSSProperties = {
    marginTop: '0.9rem',
    padding: '1rem 1.1rem',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
};

const eyebrow: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '0.4rem',
    fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
    color: 'var(--gold)',
};

const button: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
    padding: '0.5rem 1rem', borderRadius: 'var(--radius-pill)',
    border: '1px solid var(--border-strong)', background: 'var(--navy)',
    color: 'var(--white)', fontWeight: 700, fontSize: '0.85rem', textDecoration: 'none',
};

const quote: React.CSSProperties = {
    margin: '0.5rem 0 0 0.9rem',
    padding: '0.1rem 0 0.1rem 0.75rem',
    borderLeft: '2px solid var(--gold)',
    fontStyle: 'italic', fontSize: '0.88rem', lineHeight: 1.5,
    color: 'var(--white)',
};
