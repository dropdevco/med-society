import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSparkle, IconSearch } from '../icons/Icons';

interface SmartSearchBarProps {
    /** The description currently searched, so the bar can be refined in place. */
    initial?: string;
    onSubmit: (text: string) => void;
    /** Results toolbar: just the box, no label or hint. */
    compact?: boolean;
    /** Focus the field on mount — used when the toolbar toggle switches to it. */
    autoFocus?: boolean;
}

/**
 * "Describe what you feel" search, answered from patient reviews.
 *
 * Deliberately a separate box from the segmented search: that one asks for a
 * kind of doctor, this one for a problem in the patient's own words. One box
 * doing both would leave people guessing which kind of text it wants.
 */
export function SmartSearchBar({ initial = '', onSubmit, compact, autoFocus }: SmartSearchBarProps) {
    const { t } = useTranslation();
    const [text, setText] = useState(initial);
    const inputRef = useRef<HTMLInputElement>(null);

    // Adopt a query changed elsewhere (back button, a shared link).
    const [seen, setSeen] = useState(initial);
    if (initial !== seen) {
        setSeen(initial);
        setText(initial);
    }

    const ready = text.trim().length >= 3;

    return (
        <form
            className={`ms-smart${compact ? ' is-compact' : ''}`}
            role="search"
            onSubmit={(e) => {
                e.preventDefault();
                // Too short to search: point at the box rather than sit dimmed
                // and unexplained, which read as a broken button.
                if (ready) onSubmit(text.trim());
                else inputRef.current?.focus();
            }}
        >
            <label className="ms-smart-label" htmlFor={compact ? 'ms-smart-q-compact' : 'ms-smart-q'}>
                <IconSparkle size={15} weight={2} />
                {t('smart.label')}
                <span className="ms-smart-new">{t('smart.new')}</span>
            </label>
            <div className="ms-smart-box">
                {compact && <IconSparkle size={16} weight={2} style={{ color: 'var(--gold)', flexShrink: 0 }} />}
                <input
                    ref={inputRef}
                    id={compact ? 'ms-smart-q-compact' : 'ms-smart-q'}
                    type="text"
                    value={text}
                    maxLength={300}
                    autoComplete="off"
                    autoFocus={autoFocus}
                    placeholder={t('smart.placeholder')}
                    aria-label={t('smart.label')}
                    onChange={(e) => setText(e.target.value)}
                />
                <button type="submit" className="ms-smart-btn press" aria-label={t('smart.submit')}>
                    <IconSearch size={16} weight={2} />
                    <span className="ms-smart-btn-text">{t('smart.submit')}</span>
                </button>
            </div>
            <p className="ms-smart-hint">{t('smart.hint')}</p>
        </form>
    );
}
