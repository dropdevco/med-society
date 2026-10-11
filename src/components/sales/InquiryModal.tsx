import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { submitInquiry, type InquiryResult } from '../../lib/leads';
import { SpecialtyLabels } from '../../types/provider';
import type { Specialty } from '../../types/provider';
import { IconClose, IconCheck, IconArrowRight } from '../icons/Icons';

const SPECIALTY_KEYS = Object.keys(SpecialtyLabels) as Specialty[];

interface InquiryModalProps {
    onClose: () => void;
    /** Which plan the visitor clicked from, recorded with the lead. */
    plan?: string;
}

/**
 * Rendered only while open — the caller mounts and unmounts it, so form state
 * resets naturally on each open rather than needing a reset effect.
 */
export function InquiryModal({ onClose, plan }: InquiryModalProps) {
    const { t, i18n } = useTranslation();
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<InquiryResult | null>(null);
    const [citySelect, setCitySelect] = useState('');

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setSubmitting(true);

        const res = await submitInquiry({
            clinic: String(data.get('clinic') ?? '').trim(),
            contact: String(data.get('contact') ?? '').trim(),
            email: String(data.get('email') ?? '').trim(),
            phone: String(data.get('phone') ?? '').trim() || undefined,
            specialty: String(data.get('specialty') ?? '') || undefined,
            city: citySelect === 'Other'
                ? String(data.get('cityOther') ?? '').trim() || undefined
                : String(data.get('city') ?? '') || undefined,
            message: String(data.get('message') ?? '').trim() || undefined,
            locale: i18n.language,
            plan,
        });

        setSubmitting(false);
        setResult(res);
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 300,
                background: 'rgba(8, 15, 28, 0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '1.25rem',
                overflowY: 'auto',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={t('sales.formTitle')}
                style={{
                    width: '100%', maxWidth: 560,
                    background: 'var(--navy-800)',
                    border: '1px solid var(--border)',
                    borderRadius: 'calc(var(--radius) + 6px)',
                    boxShadow: 'var(--shadow)',
                    animation: 'fadeIn 0.24s var(--ease-out) both',
                    margin: 'auto',
                }}
            >
                {/* Header */}
                <div
                    style={{
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                        gap: '1rem', padding: '1.6rem 1.6rem 1rem',
                        borderBottom: '1px solid var(--border)',
                    }}
                >
                    <div>
                        <span className="eyebrow">{t('sales.formEyebrow')}</span>
                        <h2 className="display" style={{ fontSize: '1.85rem', marginTop: '0.4rem' }}>
                            {result?.status === 'saved' ? t('sales.formThanksTitle') : t('sales.formTitle')}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t('drawer.close')}
                        className="press"
                        style={{
                            background: 'var(--surface)', border: '1px solid var(--border)',
                            borderRadius: 9, padding: '0.45rem', color: 'var(--gray-300)',
                            display: 'flex', flexShrink: 0,
                        }}
                    >
                        <IconClose size={18} weight={2} />
                    </button>
                </div>

                {result?.status === 'saved' ? (
                    <div style={{ padding: '2.25rem 1.6rem', textAlign: 'center' }}>
                        <div
                            style={{
                                width: 58, height: 58, borderRadius: '50%', margin: '0 auto 1.25rem',
                                background: 'var(--mx-soft)', color: 'var(--green)',
                                border: '1px solid var(--green)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            <IconCheck size={28} weight={2.2} />
                        </div>
                        <p style={{ fontSize: '1rem', color: 'var(--gray-300)', lineHeight: 1.65, maxWidth: 380, margin: '0 auto' }}>
                            {t('sales.formThanksBody')}
                        </p>
                        <button
                            onClick={onClose}
                            className="press"
                            style={{
                                marginTop: '1.75rem', padding: '0.8rem 1.75rem',
                                borderRadius: 'var(--radius-pill)',
                                background: 'var(--brand)', color: 'var(--on-brand)',
                                fontWeight: 700, fontSize: '0.95rem',
                            }}
                        >
                            {t('sales.formDone')}
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} style={{ padding: '1.4rem 1.6rem 1.75rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.9rem' }}>
                            <Field name="clinic" label={t('sales.formClinic')} required />
                            <Field name="contact" label={t('sales.formContact')} required />
                            <Field name="email" label={t('sales.formEmail')} type="email" required />
                            <Field name="phone" label={t('sales.formPhone')} type="tel" />

                            <label style={labelStyle}>
                                {t('sales.formSpecialty')}
                                <select name="specialty" style={inputStyle} defaultValue="">
                                    <option value="">{t('sales.formSelect')}</option>
                                    {SPECIALTY_KEYS.map((k) => (
                                        <option key={k} value={k}>{t(`specialties.${k}`)}</option>
                                    ))}
                                </select>
                            </label>

                            <label style={labelStyle}>
                                {t('sales.formCity')}
                                <select
                                    name="city"
                                    style={inputStyle}
                                    value={citySelect}
                                    onChange={(e) => setCitySelect(e.target.value)}
                                >
                                    <option value="">{t('sales.formSelect')}</option>
                                    <option value="El Paso">El Paso, TX</option>
                                    <option value="Ciudad Juarez">Ciudad Juárez, CHIH</option>
                                    <option value="San Diego">San Diego, CA</option>
                                    <option value="Tijuana">Tijuana, BC</option>
                                    <option value="Other">{t('sales.formOther')}</option>
                                </select>
                            </label>

                            {citySelect === 'Other' && (
                                <Field
                                    name="cityOther"
                                    label={t('sales.formCityOtherLabel')}
                                    placeholder={t('sales.formCityOtherPlaceholder')}
                                    required
                                />
                            )}
                        </div>

                        <label style={{ ...labelStyle, marginTop: '0.9rem' }}>
                            {t('sales.formMessage')}
                            <textarea
                                name="message"
                                rows={3}
                                style={{ ...inputStyle, resize: 'vertical', minHeight: 84 }}
                                placeholder={t('sales.formMessagePlaceholder')}
                            />
                        </label>

                        {result?.status === 'email' && (
                            <p
                                style={{
                                    marginTop: '1rem', padding: '0.85rem 1rem',
                                    background: 'var(--gold-dim)', border: '1px solid var(--gold)',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.85rem', color: 'var(--white)', lineHeight: 1.55,
                                }}
                            >
                                {t('sales.formFallback')}{' '}
                                <a href={result.mailto} style={{ color: 'var(--gold)', fontWeight: 700, textDecoration: 'underline' }}>
                                    {t('sales.formFallbackLink')}
                                </a>
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={submitting}
                            className="press"
                            style={{
                                marginTop: '1.35rem', width: '100%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.55rem',
                                padding: '0.95rem 1.5rem',
                                borderRadius: 'var(--radius-pill)',
                                background: 'var(--brand)', color: 'var(--on-brand)',
                                fontWeight: 700, fontSize: '1rem',
                                opacity: submitting ? 0.65 : 1,
                                cursor: submitting ? 'progress' : 'pointer',
                            }}
                        >
                            {submitting ? t('sales.formSending') : t('sales.formSubmit')}
                            {!submitting && <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={17} weight={2} /></span>}
                        </button>

                        <p style={{ marginTop: '0.9rem', fontSize: '0.78rem', color: 'var(--gray-500)', textAlign: 'center' }}>
                            {t('sales.formPrivacy')}
                        </p>
                    </form>
                )}
            </div>
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    fontSize: '0.82rem',
    fontWeight: 700,
    color: 'var(--gray-300)',
};

const inputStyle: React.CSSProperties = {
    padding: '0.7rem 0.85rem',
    background: 'var(--navy)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--white)',
    fontSize: '0.92rem',
    fontWeight: 500,
    outline: 'none',
    width: '100%',
};

function Field({ name, label, type = 'text', required = false, placeholder }: {
    name: string; label: string; type?: string; required?: boolean; placeholder?: string;
}) {
    return (
        <label style={labelStyle}>
            <span>
                {label}
                {required && <span style={{ color: 'var(--gold)' }}> *</span>}
            </span>
            <input name={name} type={type} required={required} placeholder={placeholder} style={inputStyle} />
        </label>
    );
}
