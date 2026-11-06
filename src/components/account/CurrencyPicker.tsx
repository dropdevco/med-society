import { useTranslation } from 'react-i18next';
import type { Market } from '../../lib/billing';

interface CurrencyPickerProps {
    value: Market;
    onChange: (market: Market) => void;
    id?: string;
    disabled?: boolean;
}

export function CurrencyPicker({ value, onChange, id, disabled = false }: CurrencyPickerProps) {
    const { t } = useTranslation();

    return (
        <div
            id={id}
            role="group"
            aria-label={t('pricing.currency')}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.2rem',
                padding: '0.2rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--surface)',
            }}
        >
            <button
                type="button"
                className="press"
                aria-pressed={value === 'us'}
                disabled={disabled}
                onClick={() => onChange('us')}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0.35rem 0.85rem',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    border: 'none',
                    transition: 'var(--transition)',
                    background: value === 'us' ? 'var(--navy-800)' : 'transparent',
                    color: value === 'us' ? 'var(--white)' : disabled ? 'var(--gray-500)' : 'var(--gray-400)',
                    boxShadow: value === 'us' ? 'var(--shadow-sm)' : 'none',
                }}
            >
                USD
            </button>
            <button
                type="button"
                className="press"
                aria-pressed={value === 'mx'}
                disabled={disabled}
                onClick={() => onChange('mx')}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0.35rem 0.85rem',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    border: 'none',
                    transition: 'var(--transition)',
                    background: value === 'mx' ? 'var(--navy-800)' : 'transparent',
                    color: value === 'mx' ? 'var(--white)' : disabled ? 'var(--gray-500)' : 'var(--gray-400)',
                    boxShadow: value === 'mx' ? 'var(--shadow-sm)' : 'none',
                }}
            >
                MXN
            </button>
        </div>
    );
}

