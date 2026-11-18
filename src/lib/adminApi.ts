import { supabase } from './supabase';
import { pingClaimEmails } from './claims';

/**
 * Admin dashboard data. Every call goes through a SECURITY DEFINER function
 * that raises for anyone who is not in public.app_admins, so nothing here is a
 * security boundary: a non-admin who calls these gets an error, not data.
 */

export interface SummaryRow {
    form_slug: string; form_segment: string; lang: string;
    page_opens: number; visits: number; unique_visitors: number; started: number; submissions: number;
    abandoned: number; start_rate_pct: number | null; submit_rate_pct: number | null;
    completion_of_started_pct: number | null; avg_seconds_to_submit: number | null;
    visits_with_send_error: number; last_activity: string | null; responses_on_record: number;
}
export interface FunnelRow {
    form_slug: string; form_segment: string; lang: string; screen_no: number; step_id: string;
    visits_reached: number; visits_passed: number; validation_errors: number; avg_seconds_on_screen: number | null;
}
export interface SourceRow {
    form_slug: string; form_segment: string; lang: string; ref: string | null;
    utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
    utm_content: string | null; utm_term: string | null; referrer_host: string | null;
    visits: number; unique_visitors: number; started: number; submissions: number;
}
export interface DailyRow {
    day: string; form_slug: string; form_segment: string; lang: string;
    page_opens: number; visits: number; unique_visitors: number; started: number; submissions: number;
}
export interface AudienceRow {
    form_slug: string; form_segment: string; lang: string; country: string | null; region: string | null;
    city: string | null; device_type: string | null; os: string | null; browser: string | null;
    visits: number; submissions: number;
}
export interface ResponseRow {
    id: number; created_at: string; form_slug: string; segment: string; lang: string; ref: string | null;
    session: string; industry: string | null; city: string | null;
    contact_name: string | null; contact_org: string | null; contact_email: string | null; contact_phone: string | null;
    follow_up: boolean | null; duration_s: number | null; outcome: string | null;
    answers: Record<string, unknown>;
}
export interface AnswerRow { segment: string; q: string; v: string; n: number }

export interface FormsOverview {
    generated_at: string;
    summary: SummaryRow[];
    funnel: FunnelRow[];
    by_source: SourceRow[];
    daily: DailyRow[];
    audience: AudienceRow[];
    responses_total: number;
    responses_test: number;
    responses_by: { form_slug: string; segment: string; lang: string; n: number; follow_up: number; avg_duration_s: number | null }[];
    responses_daily: { day: string; segment: string; n: number }[];
    by_ref: { ref: string; n: number }[];
    by_city: { segment: string; city: string; n: number }[];
    by_industry: { segment: string; industry: string; n: number }[];
    outcomes: { segment: string; outcome: string; n: number }[];
    answers: AnswerRow[];
    recent: ResponseRow[];
}

export interface SiteOverview {
    generated_at: string;
    providers: {
        total: number;
        by_region: { region: string; status: string; n: number }[];
        by_region_source: { region: string; source: string; n: number }[];
        by_city: { region: string; city: string; n: number }[];
        by_specialty: { region: string; specialty: string; n: number }[];
        by_tier: { tier: string; n: number }[];
        flags: Record<'verified' | 'promoted' | 'licensed' | 'languages_confirmed' | 'self_listed' | 'pending_review' | 'hidden', number>;
        completeness: Record<string, number>;
    };
    accounts: {
        users: number; confirmed: number; signed_in_30d: number; owners: number; claimed_listings: number;
        claims_by_status: { status: string; n: number }[];
        signups_daily: { day: string; n: number }[];
        claimed_by_region: { region: string; n: number }[];
        invites: { sent: number; accepted: number };
        team_links: number; photos: number;
    };
    community: {
        threads: number; replies: number; inquiries: number; leads: number;
        inquiries_by_status: { status: string; n: number }[];
        leads_by_status: { status: string; n: number }[];
        recent_leads: Record<string, string | null>[];
        recent_inquiries: Record<string, string | null>[];
    };
    owners: { id: string; name: string; city: string | null; region: string | null; status: string; owner_email: string | null; role: string; claimed_at: string }[];
}

export interface ProviderHit {
    id: string; name: string; city: string | null; region: string | null; country: string | null;
    status: string; source: string | null; specialty: string[] | null; phone: string | null;
    website: string | null; verified: boolean; claimed: boolean;
}
export interface ProviderDetail {
    provider: Record<string, unknown>;
    details: Record<string, unknown> | null;
    owners: { email: string | null; role: string; since: string }[];
    claims: { status: string; evidence: string | null; created_at: string; email: string | null }[];
    photos: number; inquiries: number; threads: number;
    survey_responses: { created_at: string; form_slug: string; segment: string; outcome: string | null }[];
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
}

export async function isAdmin(): Promise<boolean> {
    try { return (await rpc<boolean>('is_app_admin')) === true; } catch { return false; }
}
export const fetchForms = () => rpc<FormsOverview>('admin_forms_overview');
export const fetchSite = () => rpc<SiteOverview>('admin_site_overview');
export const searchProviders = (q: string) => rpc<ProviderHit[]>('admin_provider_search', { q, lim: 25 });
export const fetchProvider = (pid: string) => rpc<ProviderDetail | null>('admin_provider_detail', { pid });

export interface MatchCandidate {
    doctor_id: string; display_name: string; similarity: number;
    regions: string[]; listings: string[]; specialties: string[];
}
/** The AI scorer's latest view of a queued item (docs/adr/0012). Evidence for the reviewer, never a decision. */
export interface AiScore {
    score: number; verdict: 'approve' | 'reject' | 'needs_human'; reason: string;
    /** The doctor or listing it judged most likely, or the proposed one when it found none. */
    candidate: string; model: string; scored_at: string; run: string;
}
export interface MatchItem {
    source_slug: string; external_id: string; tier: number; confidence: number | null; candidates: MatchCandidate[];
    name: string; label: string; specialties: string[]; cedulas: string[]; region: string | null; url: string | null;
    valid_to: string | null; facts: { consejo?: string; certificate?: string } | null;
    /** Absent before migration 0051, null when the item has not been scored. */
    ai_score?: AiScore | null;
}
export interface MatchQueue { total: number; exact: number; items: MatchItem[] }
export interface FacilityCandidate { provider_id: string; name: string; similarity: number; region: string | null }
export interface FacilityItem {
    source_slug: string; external_id: string; provider_id: string | null; confidence: number | null; candidates: FacilityCandidate[];
    name: string; label: string; region: string | null; url: string | null; valid_to: string | null; facts: { register?: string } | null;
    ai_score?: AiScore | null;
}
export interface FacilityQueue { total: number; items: FacilityItem[] }
export interface SourceOverview {
    slug: string; name: string; access: string; entity: 'doctor' | 'facility'; permission_granted_on: string | null;
    last_run: { id: string; started_at: string; status: 'green' | 'red'; reasons: string[]; counts: Record<string, number> } | null;
    matches: Record<string, number>;
    badges: number;
}
export const fetchSources = () => rpc<SourceOverview[]>('admin_sources_overview');
export const fetchMatchQueue = (source: string | null, limit: number, offset: number) =>
    rpc<MatchQueue>('admin_match_queue', { p_source: source, p_limit: limit, p_offset: offset });
export const decideMatch = (source: string, external: string, decision: 'confirm' | 'reject', doctor?: string) =>
    rpc<void>('admin_match_decide', { p_source: source, p_external: external, p_decision: decision, p_doctor: doctor ?? null });
export const confirmExactMatches = (source: string) => rpc<number>('admin_match_confirm_exact', { p_source: source });
/** One record beside each candidate doctor (migration 0052). */
export interface CompareCandidate {
    doctor_id: string; display_name: string; similarity: number | null; linked: boolean;
    cedulas: { cedula: string; title: string | null; kind: string | null }[];
    listings: { id: string; name: string; city: string | null; region: string | null; specialty: string[] | null; kind: string | null }[];
    badges: { organization: string; label: string | null; source: string }[];
}
export interface MatchCompare {
    status: string; tier: number; confidence: number | null; doctor_id: string | null;
    record: { name: string; label: string | null; specialties: string[] | null; cedulas: string[] | null; region: string | null;
        url: string | null; valid_to: string | null; facts: Record<string, string> | null } | null;
    candidates: CompareCandidate[];
    ai: (AiScore & { evidence: unknown }) | null;
    link: { doctor_id: string; score: number; run: string; linked_at: string } | null;
}
export const fetchMatchCompare = (source: string, external: string) =>
    rpc<MatchCompare | null>('admin_match_compare', { p_source: source, p_external: external });
/** A record the AI scored near the auto-link bar, or a cédula conflict (migration 0052). */
export interface NearBarItem {
    source_slug: string; external_id: string; score: number; verdict: AiScore['verdict']; reason: string; scored_at: string; run: string;
    status: 'probable' | 'confirmed'; tier: number; name: string; label: string | null; region: string | null; candidate: string | null; linked: boolean;
}
export const fetchNearBar = (sinceDays = 14) =>
    rpc<NearBarItem[]>('review_near_bar', { p_since: new Date(Date.now() - sinceDays * 86_400_000).toISOString() });
export const fetchFacilityQueue = () => rpc<FacilityQueue>('admin_facility_queue', { p_limit: 200, p_offset: 0 });
export const decideFacility = (source: string, external: string, decision: 'confirm' | 'reject', provider?: string) =>
    rpc<void>('admin_facility_decide', { p_source: source, p_external: external, p_decision: decision, p_provider: provider ?? null });

export interface BillingSub {
    id: string; provider_id: string; provider_name: string; city: string | null; plan: string; market: string | null;
    status: string; paid_through: string | null; last_payment_at: string | null; last_amount: number | null;
    currency: string | null; payer_email: string | null; ghl_contact_id: string | null; ghl_dirty: boolean;
    ghl_error: string | null; access: boolean; listing_tier: string; refund_flag: boolean;
}
export interface BillingEvent {
    id: string; created_at: string; kind: string; plan: string | null; market: string | null;
    payer_email: string | null; payer_phone?: string | null; ghl_contact_id?: string | null;
    amount?: number | null; currency?: string | null; product?: string | null;
    outcome: string; detail: string | null; match_method?: string | null; provider_name?: string | null;
    resolved_by?: string | null;
}
export interface BillingOverview {
    generated_at: string;
    subscriptions: BillingSub[];
    needs_attention: BillingEvent[];
    recent_events: BillingEvent[];
    tier_drift: { provider_id: string; name: string; tier: string }[];
}
export const fetchBilling = () => rpc<BillingOverview>('admin_billing_overview');
export const resolveBillingEvent = (eid: string, pid: string, plan: string | null) =>
    rpc<{ outcome: string; detail?: string }>('admin_resolve_billing_event', { eid, pid, p_plan: plan });
export const endPlan = (sid: string) => rpc<string>('admin_end_plan', { sid });

export interface FeedbackItem {
    id: string; created_at: string; kind: 'bug' | 'content' | 'idea' | 'other'; message: string;
    page_path: string | null; language: string | null; contact_email: string | null; account_email: string | null;
    viewport: string | null; app_build: string | null; user_agent: string | null;
    client_errors: { type: string; msg: string; path: string }[];
    verdict: string | null; confidence: number | null; severity: 'low' | 'medium' | 'high' | null;
    reason: string | null; triage_source: 'model' | 'heuristic' | null;
    corroborated: boolean; duplicate_count: number; escalated: boolean; notified_at: string | null;
    status: 'new' | 'open' | 'resolved' | 'dismissed'; admin_note: string | null; resolved_at: string | null;
}
export interface FeedbackOverview {
    generated_at: string;
    counts: { total: number; last_30d: number; needs_attention: number; unreviewed: number };
    by_verdict: { verdict: string; n: number }[];
    items: FeedbackItem[];
}
export const fetchFeedback = () => rpc<FeedbackOverview>('admin_feedback_overview');
export const setFeedbackStatus = (fid: string, status: FeedbackItem['status']) =>
    rpc<void>('admin_feedback_set_status', { fid, new_status: status });

// ── Claims (migration 0047) ─────────────────────────────────────────────────
export type ClaimStatus = 'incomplete' | 'pending' | 'needs_info' | 'approved' | 'rejected';
export interface ClaimQueueItem {
    id: string; status: ClaimStatus; claimant_role: 'doctor' | 'owner' | 'manager' | null; legal_name: string | null;
    created_at: string; submitted_at: string | null; reviewed_at: string | null;
    provider_id: string; provider_name: string; city: string | null; country: string; region: string | null;
    account_email: string | null; flags: string[]; cedula_check: string | null; documents: number;
}
export interface ClaimQueue {
    generated_at: string;
    counts: { pending: number; needs_info: number; incomplete: number; approved_30d: number; rejected_30d: number };
    items: ClaimQueueItem[];
}
export interface ClaimSignals {
    account_email: string | null; email_confirmed: boolean; account_age_days: number;
    email_matches_listing: boolean; email_domain_matches_website: boolean; phone_matches_listing: boolean;
    registry_doctor: string | null; cedulas_on_file: string[] | null; cedula_check: string;
    npi_valid: boolean | null; name_similarity: number | null; listing_owners: number;
    other_open_claims_on_listing: number; claimant_open_claims: number; claimant_rejected_claims: number;
    documents: Record<string, number>; flags: string[];
}
export interface ClaimDetail {
    claim: {
        id: string; status: ClaimStatus; claimant_role: string | null; legal_name: string | null; phone: string | null;
        cedula: string | null; npi: string | null; license_number: string | null; license_state: string | null; rfc: string | null;
        evidence: string | null; created_at: string; submitted_at: string | null; reviewed_at: string | null;
        review_note: string | null; reviewer_note: string | null; reviewer_checks: Record<string, unknown> | null;
        history: { at: string; by: string; event: string; status: string; note?: string }[];
        signals: ClaimSignals;
    };
    listing: { id: string; name: string; address: string | null; city: string | null; country: string; region: string | null;
        phone: string | null; email: string | null; website: string | null; source: string | null; specialty: string[] | null };
    owners: { email: string | null; role: string; since: string }[];
    documents: { id: string; kind: string; path: string; created_at: string }[];
    other_claims: { id: string; status: string; provider_name: string; created_at: string }[];
    rival_claims: { id: string; status: string; legal_name: string | null; email: string | null }[];
}
export interface ClaimChecks { id_matches_name: boolean; credential_verified: boolean; contact_confirmed: boolean }
export const fetchClaimQueue = () => rpc<ClaimQueue>('admin_claims_queue');
export const fetchClaimDetail = (id: string) => rpc<ClaimDetail>('admin_claim_detail', { p_claim: id });
export async function decideClaim(id: string, decision: 'approve' | 'reject' | 'needs_info', message: string, note: string, checks: ClaimChecks) {
    const out = await rpc<{ status: ClaimStatus }>('admin_claim_decide', { p_claim: id, p_decision: decision, p_message: message || null, p_note: note || null, p_checks: checks });
    void pingClaimEmails();
    return out;
}
export interface ClaimEmail { kind: string; created_at: string; sent_at: string | null; attempts: number; last_error: string | null }
export const fetchClaimEmails = (id: string) => rpc<ClaimEmail[]>('admin_claim_emails', { p_claim: id });
/** A short-lived link to one uploaded document (the bucket is private; admins may read it). */
export async function claimDocumentUrl(path: string): Promise<string> {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.storage.from('claim-documents').createSignedUrl(path, 300);
    if (error || !data) throw new Error(error?.message ?? 'Could not open the document');
    return data.signedUrl;
}
