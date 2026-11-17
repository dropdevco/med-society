import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { setListingKind } from '../../lib/team';
import { useToast } from './toastContext';

/**
 * "Is this a clinic or one doctor?" It decides which public page the listing
 * gets: a clinic page shows its doctors and focus areas, a doctor's page shows
 * one person. Saved on its own (set_listing_kind), not with the form below,
 * because it changes what the rest of the dashboard offers.
 */
export function ListingKindCard({ clinic, onSaved }: { clinic: Provider; onSaved: () => void }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    // Recovery stays are set by our team.
    if (clinic.kind === 'stay') return null;
    const isClinic = clinic.kind === 'clinic';

    const choose = async (kind: 'clinic' | null) => {
        if ((kind === 'clinic') === isClinic) return;
        setBusy(true);
        const { error } = await setListingKind(clinic.id, kind);
        setBusy(false);
        if (error) toast(t(`team.err.${error}`, { defaultValue: t('team.err.unknown') }), 'error');
        else { toast(t('account.kindSaved')); onSaved(); }
    };

    return (
        <section className="acct-card" aria-labelledby="acct-kind-title">
            <h2 id="acct-kind-title" className="acct-card-title">{t('account.kindTitle')}</h2>
            <div className="acct-row" role="radiogroup" aria-labelledby="acct-kind-title">
                {([['clinic', t('account.kindClinic'), t('account.kindClinicHint')],
                   [null, t('account.kindDoctor'), t('account.kindDoctorHint')]] as const).map(([kind, label, hint]) => {
                    const on = (kind === 'clinic') === isClinic;
                    return (
                        <button
                            key={label} type="button" role="radio" aria-checked={on} disabled={busy}
                            onClick={() => void choose(kind)}
                            className={`acct-choice${on ? ' is-on' : ''}`}
                        >
                            <strong>{label}</strong>
                            <span className="acct-hint">{hint}</span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
