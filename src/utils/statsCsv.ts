import type { ProviderStats } from '../hooks/useProviderStats';

/** The daily table as a spreadsheet-friendly CSV body (the download adds a BOM so Excel reads accents). */
export function dailyCsv(daily: NonNullable<ProviderStats['daily']>): string {
    const rows = [
        ['date', 'profile_views', 'contacts', 'shown_in_results'],
        ...daily.map((d) => [d.day, d.views, d.contacts, d.impressions]),
    ];
    return rows.map((r) => r.join(',')).join('\r\n');
}
