import { supabase } from './supabase';

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
