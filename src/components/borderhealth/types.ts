/**
 * The seam between the border-health survey (/borderhealth) and the clinic
 * onboarding step that follows a provider's submission.
 *
 * The survey owns everything up to a successful `bh_responses` insert, then
 * hands this object to <BorderhealthOnboarding>. Onboarding never re-asks
 * anything that is already in here.
 */

export type BhLang = 'es' | 'en';
export type BhSegment = 'employer' | 'employee' | 'provider';

export interface BhContact {
    name: string;
    /** Clinic / practice / company name. */
    org: string;
    email: string;
    phone: string;
    whatsapp: string;
}

export interface BhSubmission {
    /**
     * Client-generated uuid stored in bh_responses.submission_key. Anon cannot
     * read bh_responses back, so this is how the claim/listing RPCs find the
     * row to link. Null when the insert did not go through.
     */
    submissionKey: string | null;
    segment: BhSegment;
    lang: BhLang;
    /** 'live' | 'test' — from ?session=. Test submissions still onboard. */
    session: string;
    contact: BhContact;
    /** Human-readable city label as answered ("Ciudad Juárez", or the Other text). */
    city: string;
    /** Stable option key for the city question: juarez | elpaso | tijuana | sandiego | chihuahua_city | other. */
    cityKey: string;
    /** practice_type option key: gp | specialist | dental | vision | imaging_lab | hospital | pharmacy | other. */
    practiceType: string;
    /** Free text specialty, when practice_type is specialist. */
    specialty: string;
    /** Website or profile answer, if given. */
    website: string;
    /** The full answers object exactly as inserted into bh_responses.answers. */
    answers: Record<string, unknown>;
}

/** Row shape returned by the bh_match_providers RPC. */
export interface BhMatch {
    id: string;
    name: string;
    address: string;
    city: string;
    country: 'MX' | 'US' | string;
    specialty: string[];
    imageUrl: string | null;
    /** Listing already has an owner — a claim goes to review. */
    owned: boolean;
    score: number;
    /** Subset of: phone | email | name | city */
    reasons: string[];
}
