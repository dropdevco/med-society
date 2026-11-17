import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';

interface Row { key: string; label: string; value: string | null; field: string }

/**
 * What the platform already holds about this clinic and will use on the site, shown back to the
 * owner so they confirm or correct it instead of typing it again. Read-only: edits happen in the
 * profile tab, so there is one place where each fact lives.
 */
export function SiteKnown({ clinic, onEdit, suggesting, found }: { clinic: Provider; onEdit: (field: string) => void; suggesting: boolean; found: boolean }) {
    const { t, i18n } = useTranslation();
    const es = i18n.language?.startsWith('es');
    const names = (clinic.services ?? []).map((s) => (!es && s.nameEn ? s.nameEn : s.name));
    const rows: Row[] = [
        { key: 'phone', label: t('account.site.known.phone'), value: clinic.phone?.trim() || null, field: 'acct-phone' },
        { key: 'whatsapp', label: t('account.site.known.whatsapp'), value: clinic.socials?.whatsapp ? clinic.socials.whatsapp.replace(/^https?:\/\/(wa\.me\/)?/, '+') : null, field: 'acct-socials' },
        { key: 'services', label: t('account.site.known.services'), value: names.length ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : null, field: 'acct-description' },
        { key: 'languages', label: t('account.site.known.languages'), value: clinic.languagesConfirmed && clinic.languages.length ? clinic.languages.join(', ').toUpperCase() : null, field: 'acct-languages' },
        { key: 'insurance', label: t('account.site.known.insurance'), value: clinic.insurances?.length ? `${clinic.insurances.slice(0, 3).join(', ')}${clinic.insurances.length > 3 ? ` +${clinic.insurances.length - 3}` : ''}` : null, field: 'acct-description' },
        { key: 'licence', label: t('account.site.known.licence'), value: clinic.licensed ? t('account.site.known.licenceYes') : null, field: 'acct-description' },
        { key: 'rating', label: t('account.site.known.rating'), value: clinic.reviewCount > 0 ? t('account.site.known.ratingValue', { rating: clinic.rating.toFixed(1), count: clinic.reviewCount }) : null, field: 'acct-description' },
        { key: 'website', label: t('account.site.known.website'), value: clinic.website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') || null, field: 'acct-description' },
    ];
    const have = rows.filter((r) => r.value).length;

    return (
        <section className="acct-card">
            <div className="acct-card-head">
                <h2 className="acct-card-title">{t('account.site.known.title')}</h2>
                <span className="acct-pill">{t('account.site.known.count', { have, total: rows.length })}</span>
            </div>
            <p className="acct-muted">{t('account.site.known.hint')}</p>
            <ul className="sb-known">
                {rows.map((r) => (
                    <li key={r.key} className={r.value ? 'is-have' : 'is-missing'}>
                        <span className="sb-known-mark" aria-hidden>{r.value ? '✓' : '+'}</span>
                        <span className="sb-known-label">{r.label}</span>
                        <span className="sb-known-value">{r.value ?? t('account.site.known.missing')}</span>
                        <button type="button" className="acct-link" onClick={() => onEdit(r.field)}>{r.value ? t('account.site.known.edit') : t('account.site.known.add')}</button>
                    </li>
                ))}
            </ul>
            {suggesting && <p className="acct-fine" role="status">{t('account.site.known.reading')}</p>}
            {found && <p className="acct-fine" role="status">{t('account.site.known.found')}</p>}
        </section>
    );
}
