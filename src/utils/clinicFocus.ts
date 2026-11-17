import type { Provider, Specialty } from '../types/provider';
import type { TeamDoctor } from '../hooks/useProviderTeam';

export interface FocusArea { key: Specialty; count: number }

/**
 * What a clinic treats: its own specialties plus its doctors', most doctors
 * first. A specialty only the clinic claims still shows, with no count.
 */
export function clinicFocus(clinic: Provider, doctors: TeamDoctor[]): FocusArea[] {
    const counts = new Map<Specialty, number>();
    for (const s of clinic.specialty) counts.set(s, 0);
    for (const d of doctors) for (const s of new Set(d.specialty)) counts.set(s, (counts.get(s) ?? 0) + 1);
    return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}
