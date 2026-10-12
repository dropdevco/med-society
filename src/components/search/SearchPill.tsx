import { useTranslation } from 'react-i18next';
import type { ProviderFilters } from '../../types/provider';
import { IconSearch } from '../icons/Icons';
import { whereLabel } from '../../utils/place';

interface SearchPillProps {
    filters: ProviderFilters;
    onExpand: () => void;
}

/**
 * The collapsed search, shown in the header once results are on screen.
 *
 * It has one job beyond reopening the box: telling the user what they asked
 * for. A results page that shows 812 clinics and no statement of the query is
 * how people end up believing a filter is broken when it is merely still on.
 */
export function SearchPill({ filters, onExpand }: SearchPillProps) {
    const { t } = useTranslation();

    const what = filters.search
        || filters.specialty.map((s) => t(`specialties.${s}`)).join(', ')
        || t('search.allProviders');

    const where = whereLabel(filters, t);

    const cover = filters.insurances.length === 0
        ? t('search.anyCover')
        : filters.insurances.length === 1
            ? filters.insurances[0]
            : t('search.coverCount', { count: filters.insurances.length });

    return (
        <button onClick={onExpand} className="ms-pill" aria-label={t('search.edit')}>
            <span className="ms-pill-part is-lead">{what}</span>
            <span className="ms-pill-dot" aria-hidden="true" />
            <span className="ms-pill-part">{where}</span>
            <span className="ms-pill-dot ms-pill-cover" aria-hidden="true" />
            <span className="ms-pill-part ms-pill-cover">{cover}</span>
            <span className="ms-pill-go">
                <IconSearch size={15} weight={2.4} />
            </span>
        </button>
    );
}
