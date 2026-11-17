/**
 * The match decision for one new source record (docs/adr/0004). Pure: the
 * loader gathers the evidence, this decides.
 *
 *   tier 1  a cédula we already hold: confirmed by the system
 *   tier 3  no cédula match, similar name: probable, a person decides
 *   tier 4  nothing similar: unmatched
 *
 * Tier 2 of the proposal (a cédula one digit off) is not built yet.
 */

export interface NameCandidate {
    doctor_id: string;
    display_name: string;
    similarity: number;
    regions: string[];
    listings: string[];
    specialties: string[];
}

export interface MatchDecision {
    doctorId: string | null;
    status: 'confirmed' | 'probable' | 'unmatched';
    tier: 1 | 3 | 4;
    confidence: number | null;
    candidates: NameCandidate[];
}

/** A candidate in another region is less likely the same person. */
export const OTHER_REGION_PENALTY = 0.1;

function score(c: NameCandidate, region: string | null): number {
    const elsewhere = region && c.regions.length && !c.regions.includes(region);
    return Math.round((c.similarity - (elsewhere ? OTHER_REGION_PENALTY : 0)) * 1000) / 1000;
}

/** A listing that may be this facility. */
export interface FacilityCandidate {
    provider_id: string;
    name: string;
    similarity: number;
    region: string | null;
}

export interface FacilityDecision {
    providerId: string | null;
    status: 'confirmed' | 'probable' | 'unmatched';
    tier: 1 | 3 | 4;
    confidence: number | null;
    candidates: FacilityCandidate[];
}

/** docs/adr/0008: a register number we already tied to a listing confirms; a name alone never does. */
export function decideFacility(input: { registerListing: string | null; candidates: FacilityCandidate[] }): FacilityDecision {
    if (input.registerListing) return { providerId: input.registerListing, status: 'confirmed', tier: 1, confidence: 1, candidates: [] };
    const ranked = [...input.candidates].sort((a, b) => b.similarity - a.similarity);
    if (ranked.length) return { providerId: ranked[0].provider_id, status: 'probable', tier: 3, confidence: ranked[0].similarity, candidates: ranked };
    return { providerId: null, status: 'unmatched', tier: 4, confidence: null, candidates: [] };
}

export function decide(input: {
    /** Doctors already holding one of the record's cédulas. */
    cedulaDoctors: string[];
    candidates: NameCandidate[];
    region: string | null;
}): MatchDecision {
    const ranked = [...input.candidates].sort((a, b) => score(b, input.region) - score(a, input.region));
    const doctors = [...new Set(input.cedulaDoctors)];

    if (doctors.length === 1) {
        // A cédula is proof, unless the name is nothing like the doctor's: then a typo is likelier.
        const named = ranked.find((c) => c.doctor_id === doctors[0]);
        if (named) return { doctorId: doctors[0], status: 'confirmed', tier: 1, confidence: 1, candidates: [] };
        return { doctorId: doctors[0], status: 'probable', tier: 1, confidence: 0.8, candidates: ranked };
    }
    if (doctors.length > 1) {
        // The record's cédulas point at two doctors: they may be one person. A reviewer looks.
        return { doctorId: doctors[0], status: 'probable', tier: 1, confidence: 0.8, candidates: ranked };
    }
    if (ranked.length) {
        return { doctorId: ranked[0].doctor_id, status: 'probable', tier: 3, confidence: score(ranked[0], input.region), candidates: ranked };
    }
    return { doctorId: null, status: 'unmatched', tier: 4, confidence: null, candidates: [] };
}
