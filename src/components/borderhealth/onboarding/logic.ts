import { supabase } from '../../../lib/supabase';
import type { Country, Specialty } from '../../../types/provider';
import type { BhLang, BhMatch, BhSubmission } from '../types';
import type { ErrorCode } from './strings';

/**
 * Everything the onboarding step does that is not rendering: the three RPCs,
 * turning server and auth failures into codes the UI can phrase, mapping the
 * survey's practice type onto the directory's specialty keys, and the
 * localStorage hand-off that lets an email-confirmation round trip finish
 * what the person started.
 *
 * Lives apart from the .tsx so that file exports components only (fast
 * refresh), and so the page can call `resumePendingOnboarding()` without
 * pulling in any UI.
 */

// ── Specialty mapping ────────────────────────────────────────────────────────

export const SPECIALTY_KEYS: Specialty[] = [
    'general', 'dentist', 'orthodontist', 'pediatrics', 'obgyn', 'cardiology',
    'optometry', 'mental_health', 'physical_therapy', 'plastic_surgery',
    'aesthetician', 'urgent_care', 'pharmacy', 'massage', 'telehealth',
    'neurology', 'otolaryngology', 'orthopedics', 'gastroenterology',
];

/** Free-text keywords, matched against lower-cased, accent-free text. */
const KEYWORDS: [RegExp, Specialty][] = [
    // Before orthodontist: "ortopedia" also starts with "orto".
    [/ortoped|orthoped|traumat/, 'orthopedics'],
    [/\borto(?!ped)|orthodon/, 'orthodontist'],
    [/neuro/, 'neurology'],
    [/gastro|digestiv/, 'gastroenterology'],
    [/otorrino|otolaryng|\bent\b|audiol|foniat/, 'otolaryngology'],
    [/dent|odont|endodon|periodon|implant/, 'dentist'],
    [/plastic|plastica|reconstruct/, 'plastic_surgery'],
    [/estetic|aesthet|esthet|dermat|cosmet/, 'aesthetician'],
    [/gineco|gyneco|obstet|\bob\b|obgyn|ob\/gyn|\bgyn|fertil|matern/, 'obgyn'],
    [/fisio|physio|physical therap|rehab/, 'physical_therapy'],
    [/masaj|massage/, 'massage'],
    [/optom|oftalm|ophthalm|vision|lentes|optica|optic/, 'optometry'],
    [/pediat|paediat|neonat/, 'pediatrics'],
    [/cardio/, 'cardiology'],
    [/urgenc|urgent|emergenc/, 'urgent_care'],
    [/psic|psiq|psych|mental/, 'mental_health'],
    [/farmac|pharm/, 'pharmacy'],
    [/telemed|telehealth|telesalud/, 'telehealth'],
    [/general|familiar|family|interna|internal|primary|primaria/, 'general'],
];

function fold(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function keywordSpecialties(text: string): Specialty[] {
    const t = fold(text);
    if (!t.trim()) return [];
    const out: Specialty[] = [];
    for (const [re, key] of KEYWORDS) {
        if (re.test(t) && !out.includes(key)) out.push(key);
    }
    return out;
}

/**
 * Best specialty keys for a survey answer, most likely first. Never empty.
 *
 *   gp          → general
 *   specialist  → keywords in the free-text specialty, else general
 *   dental      → dentist (+ orthodontist when the text says so)
 *   vision      → optometry
 *   imaging_lab → general   (the directory has no imaging/lab key)
 *   hospital    → general, urgent_care
 *   pharmacy    → pharmacy
 *   other       → keywords in the free text, else general
 */
export function mapSpecialties(practiceType: string, specialty: string): Specialty[] {
    const fromText = keywordSpecialties(specialty);
    let base: Specialty[];
    switch (practiceType) {
        case 'gp': base = ['general']; break;
        case 'dental': base = fromText.includes('orthodontist') ? ['dentist', 'orthodontist'] : ['dentist']; break;
        case 'vision': base = ['optometry']; break;
        case 'hospital': base = ['general', 'urgent_care']; break;
        case 'pharmacy': base = ['pharmacy']; break;
        case 'imaging_lab': base = ['general']; break;
        default: base = fromText;
    }
    const out = base.length ? base : ['general' as Specialty];
    return out.slice(0, 3);
}

// ── City → country ───────────────────────────────────────────────────────────

/**
 * The survey's city option keys for the two border regions, with the city name
 * the directory stores (`providers.city`) and its country. Survey answers keep
 * their keys (existing bh_responses rows hold 'juarez' / 'elpaso').
 */
export const SURVEY_CITIES: Record<string, { city?: string; country: Country }> = {
    juarez:   { city: 'Juárez',    country: 'MX' },
    elpaso:   { city: 'El Paso',   country: 'US' },
    tijuana:  { city: 'Tijuana',   country: 'MX' },
    sandiego: { city: 'San Diego', country: 'US' },
    // Outside both regions: the answer's own label stays the city.
    chihuahua_city: { country: 'MX' },
};

/** City name to prefill the listing form with: the directory's spelling for a known key, else the answer as given. */
export function listingCityFor(cityKey: string, answered: string): string {
    return SURVEY_CITIES[cityKey]?.city ?? answered;
}

// Mexican side first: "Baja California" must not read as California.
const MX_TEXT = /\b(juarez|tijuana|chihuahua|rosarito|tecate|ensenada|mexicali|baja california)\b/;
const US_TEXT = /\b(el paso|san diego|chula vista|national city|san ysidro|otay mesa|el cajon|la mesa|escondido|oceanside|carlsbad|las cruces|texas|tx|california|ca|new mexico|nm|usa|us|eeuu|ee uu|estados unidos)\b/;

/**
 * Country of the listing's city. The city typed in the listing form wins when
 * it plainly names a place (the person may have corrected it); otherwise the
 * survey's city key decides (El Paso, San Diego → US; Juárez, Tijuana,
 * Chihuahua → MX). Only an unrecognisable "other" city defaults to MX.
 */
export function countryFor(cityKey: string, city: string): Country {
    const t = fold(city);
    if (MX_TEXT.test(t)) return 'MX';
    if (US_TEXT.test(t)) return 'US';
    return SURVEY_CITIES[cityKey]?.country ?? 'MX';
}

// ── Errors ───────────────────────────────────────────────────────────────────

const RPC_CODES: ErrorCode[] = ['not_signed_in', 'listing_not_found', 'bad_name', 'bad_country', 'too_many_pending'];

/** A PostgREST error from one of the bh_* RPCs → a code. Raised names win. */
export function rpcErrorCode(message: string | null | undefined): ErrorCode {
    const m = (message ?? '').toLowerCase();
    for (const code of RPC_CODES) if (m.includes(code)) return code;
    if (m.includes('jwt') || m.includes('permission denied')) return 'not_signed_in';
    if (m.includes('fetch') || m.includes('network') || m.includes('timeout')) return 'network';
    return 'unknown';
}

/** A message from src/lib/auth.ts (Supabase auth's own wording) → a code. */
export function authErrorCode(message: string): ErrorCode {
    const m = message.toLowerCase();
    if (m.includes('not configured')) return 'not_configured';
    if (m.includes('invalid login credentials')) return 'invalid_credentials';
    if (m.includes('already registered') || m.includes('already been registered') || m.includes('already exists')) return 'user_exists';
    if (m.includes('email not confirmed')) return 'email_not_confirmed';
    if (m.includes('rate limit') || m.includes('security purposes') || m.includes('too many')) return 'rate_limited';
    if (m.includes('password')) return 'weak_password';
    if (m.includes('email') && (m.includes('invalid') || m.includes('validate'))) return 'bad_email';
    if (m.includes('fetch') || m.includes('network')) return 'network';
    return 'unknown';
}

// ── Actions ──────────────────────────────────────────────────────────────────

export interface ListingDraft {
    name: string;
    specialty: Specialty[];
    address: string;
    city: string;
    country: Country;
    phone: string;
    email: string;
    website: string;
    description: string;
}

export type OnboardingAction =
    | { kind: 'claim'; providerId: string; providerName: string; evidence: string }
    | { kind: 'listing'; draft: ListingDraft };

export type ClaimStatus = 'approved' | 'pending' | 'owner';

export type Outcome =
    | { kind: 'claim'; status: ClaimStatus; providerName: string }
    | { kind: 'listing'; providerId: string | null }
    /** A test-session survey: the flow ran, no RPC that writes was called. */
    | { kind: 'test' }
    | { kind: 'error'; code: ErrorCode };

/** Survey facts a reviewer needs to judge a claim. Never logged. */
export function claimEvidence(sub: BhSubmission): string {
    const c = sub.contact;
    const lines = [
        `Border health survey (${sub.lang}, ${sub.session || 'live'})`,
        `Contact: ${[c.name, c.org].filter(Boolean).join(' — ')}`,
        `Email: ${c.email || '-'} · Phone: ${c.phone || '-'} · WhatsApp: ${c.whatsapp || '-'}`,
        `City: ${sub.city || '-'} · Practice: ${sub.practiceType || '-'}${sub.specialty ? ` / ${sub.specialty}` : ''}`,
        sub.website ? `Website: ${sub.website}` : '',
    ];
    return lines.filter(Boolean).join('\n').slice(0, 1500);
}

export async function matchProviders(sub: BhSubmission): Promise<BhMatch[]> {
    if (!supabase) return [];
    const c = sub.contact;
    try {
        const { data, error } = await supabase.rpc('bh_match_providers', {
            p_name: c.name || null,
            p_org: c.org || null,
            p_phone: c.phone || c.whatsapp || null,
            p_email: c.email || null,
            p_city: sub.city || null,
        });
        if (error || !Array.isArray(data)) return [];
        return (data as BhMatch[]).map((m) => ({
            ...m,
            specialty: m.specialty ?? [],
            reasons: m.reasons ?? [],
            imageUrl: m.imageUrl ?? null,
            owned: !!m.owned,
        }));
    } catch {
        return [];
    }
}

/**
 * Best-effort address → coordinates with the Maps SDK the map already loads.
 * Anything short of a clean answer inside the border region is null, and the
 * server then falls back to the city centre.
 */
async function geocodeAddress(d: ListingDraft): Promise<{ lat: number; lng: number } | null> {
    if (!d.address.trim()) return null;
    const attempt = (async () => {
        const [{ importLibrary }, { MAPS_API_KEY }] = await Promise.all([
            import('@googlemaps/js-api-loader'),
            import('../../../lib/googleMaps'),
        ]);
        if (!MAPS_API_KEY) return null;
        const lib = await importLibrary('geocoding');
        const { results } = await new lib.Geocoder().geocode({
            address: `${d.address}, ${d.city}`,
            componentRestrictions: { country: d.country },
        });
        const loc = results[0]?.geometry.location;
        if (!loc) return null;
        const lat = loc.lat();
        const lng = loc.lng();
        // Both border regions: El Paso–Juárez (~-106.5) and San Diego–Tijuana (~-117).
        if (lat < 25 || lat > 35 || lng < -118 || lng > -100) return null;
        return { lat, lng };
    })().catch(() => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
    return Promise.race([attempt, timeout]);
}

export async function runAction(action: OnboardingAction, submissionKey: string | null): Promise<Outcome> {
    if (!supabase) return { kind: 'error', code: 'not_configured' };
    try {
        if (action.kind === 'claim') {
            const { data, error } = await supabase.rpc('bh_claim_provider', {
                p_provider: action.providerId,
                p_submission: submissionKey,
                p_evidence: action.evidence,
            });
            if (error) return { kind: 'error', code: rpcErrorCode(error.message) };
            const status = (data as { status?: string } | null)?.status;
            if (status !== 'approved' && status !== 'pending' && status !== 'owner') {
                return { kind: 'error', code: 'unknown' };
            }
            return { kind: 'claim', status, providerName: action.providerName };
        }

        const d = action.draft;
        const point = await geocodeAddress(d);
        const { data, error } = await supabase.rpc('bh_submit_listing', {
            p_submission: submissionKey,
            p_name: d.name.trim(),
            p_specialty: d.specialty.length ? d.specialty : ['general'],
            p_city: d.city.trim(),
            p_country: d.country,
            p_address: d.address.trim() || null,
            p_phone: d.phone.trim() || null,
            p_email: d.email.trim() || null,
            p_website: d.website.trim() || null,
            p_description: d.description.trim() || null,
            p_lat: point?.lat ?? null,
            p_lng: point?.lng ?? null,
        });
        if (error) return { kind: 'error', code: rpcErrorCode(error.message) };
        return { kind: 'listing', providerId: (data as { provider_id?: string } | null)?.provider_id ?? null };
    } catch (e) {
        return { kind: 'error', code: rpcErrorCode(e instanceof Error ? e.message : String(e)) };
    }
}

/**
 * One in-flight run per key. React StrictMode mounts effects twice, and a
 * signed-in event can arrive while an inline sign-in is also finishing — a
 * claim is idempotent, a new listing is not, so both callers share one call.
 */
const inflight = new Map<string, Promise<Outcome>>();

export function runOnce(key: string, run: () => Promise<Outcome>): Promise<Outcome> {
    const existing = inflight.get(key);
    if (existing) return existing;
    const p = run().finally(() => {
        // Keep settled successes around briefly so a late second caller still
        // shares the result instead of re-running the RPC.
        setTimeout(() => inflight.delete(key), 30_000);
    });
    inflight.set(key, p);
    return p;
}

/** Failures a retry cannot fix: the pending action is dropped on these. */
export function isFinal(outcome: Outcome): boolean {
    if (outcome.kind !== 'error') return true;
    return ['listing_not_found', 'bad_name', 'bad_country', 'too_many_pending'].includes(outcome.code);
}

// ── Pending hand-off (email confirmation round trip) ─────────────────────────

export const PENDING_KEY = 'ms_bh_pending';
const PENDING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PendingOnboarding {
    v: 1;
    id: string;
    savedAt: number;
    lang: BhLang;
    submissionKey: string | null;
    /** The address the confirmation went to — prefilled on sign-in. */
    email: string;
    action: OnboardingAction;
}

function newId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
}

export function savePending(p: Omit<PendingOnboarding, 'v' | 'id' | 'savedAt'>): PendingOnboarding {
    const full: PendingOnboarding = { ...p, v: 1, id: newId(), savedAt: Date.now() };
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(full));
    } catch {
        // Blocked storage: the confirmation link then lands on "nothing
        // pending", and the person can still finish by signing in inline here.
    }
    return full;
}

export function readPending(): PendingOnboarding | null {
    try {
        const raw = localStorage.getItem(PENDING_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw) as PendingOnboarding;
        if (p?.v !== 1 || !p.action || !p.id) return null;
        if (Date.now() - p.savedAt > PENDING_TTL_MS) {
            clearPending();
            return null;
        }
        return p;
    } catch {
        return null;
    }
}

/** Whether the signed-in email is the one the stored request was started with. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
    return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function clearPending(): void {
    try {
        localStorage.removeItem(PENDING_KEY);
    } catch {
        // Nothing to do.
    }
}

export function resumeUrl(): string {
    return `${window.location.origin}/borderhealth?resume=1`;
}

export type ResumeResult =
    | { state: 'none' }
    | { state: 'signed_out'; pending: PendingOnboarding }
    | { state: 'wrong_account'; pending: PendingOnboarding; email: string }
    | { state: 'done'; pending: PendingOnboarding; outcome: Outcome };

/**
 * Finish whatever the person started before confirming their email.
 *
 *   none        nothing stored (or expired) — nothing to do
 *   signed_out  something stored, but no session yet — ask them to sign in
 *   wrong_account  signed in as someone other than who started it (shared
 *               device) — never run it; ask them to switch accounts
 *   done        the RPC ran; `outcome` says how. The stored action is cleared
 *               unless the failure is one a retry could fix.
 *
 * Safe to call more than once: concurrent calls share one RPC.
 */
export async function resumePendingOnboarding(): Promise<ResumeResult> {
    const pending = readPending();
    if (!pending) return { state: 'none' };
    if (!supabase) return { state: 'done', pending, outcome: { kind: 'error', code: 'not_configured' } };
    const { data } = await supabase.auth.getSession();
    if (!data.session) return { state: 'signed_out', pending };
    if (!sameEmail(data.session.user.email, pending.email)) {
        return { state: 'wrong_account', pending, email: data.session.user.email ?? '' };
    }
    const outcome = await runOnce(pending.id, () => runAction(pending.action, pending.submissionKey));
    if (isFinal(outcome)) clearPending();
    return { state: 'done', pending, outcome };
}
