import { supabase } from './supabase';

/**
 * Clinic teams, over the RPCs in supabase/migrations/0020b_clinic_teams.sql
 * and 0049_clinic_listings.sql.
 *
 * Every write goes through a SECURITY DEFINER function that checks who is
 * asking; nothing here writes a table directly. Like lib/auth.ts, each call
 * returns `{ error }` with an error *code* (the exception name the function
 * raised) rather than throwing, and the UI turns the code into words.
 */

export type TeamRole = 'owner' | 'staff';

export interface TeamMember {
    user_id: string;
    email: string;
    role: TeamRole;
    created_at: string;
    is_me: boolean;
}

export interface TeamInvite {
    id: string;
    email: string;
    role: TeamRole;
    provider_id: string;
    created_at: string;
    expires_at: string;
    expired: boolean;
}

export interface TeamPractitioner {
    id: string;
    name: string;
    specialty: string[];
    imageUrl: string | null;
    listing_status: string;
    link_status: 'active' | 'pending';
    managed: boolean;
    /** The specialist has an account and owns their listing. */
    claimed: boolean;
}

export interface TeamClinicLink {
    id: string;
    name: string;
    city: string;
    link_status: 'active' | 'pending';
    managed: boolean;
}

/** A doctor a source (Doctoralia) says practises at this clinic. Only the team sees these. */
export interface TeamSuggestion {
    id: string;
    name: string;
    specialty: string[];
    imageUrl: string | null;
    city: string | null;
    source: 'doctoralia';
    evidence: { clinic_name?: string; street?: string; city?: string };
    claimed: boolean;
}

export interface TeamOverview {
    /** The signed-in person's role on this listing: only owners change roles or invite owners. */
    my_role: TeamRole | null;
    kind: 'clinic' | 'stay' | null;
    members: TeamMember[];
    invites: TeamInvite[];
    practitioners: TeamPractitioner[];
    suggestions: TeamSuggestion[];
    /** Clinics this listing practises at, as a specialist. */
    clinics: TeamClinicLink[];
}

export interface InvitePreview {
    state: 'valid' | 'invalid' | 'used' | 'revoked' | 'expired';
    email?: string;
    role?: TeamRole;
    kind?: 'team' | 'practitioner';
    provider_id?: string;
    provider_name?: string;
    clinic_name?: string;
}

type Result<T> = { data: T | null; error: string | null };

const KNOWN = [
    'not_signed_in', 'not_on_team', 'bad_email', 'bad_role', 'not_linked', 'already_claimed',
    'already_member', 'too_many_invites', 'invite_not_found', 'invite_invalid', 'invite_used',
    'invite_expired', 'email_mismatch', 'last_owner', 'same_listing', 'listing_not_found',
    'too_many_practitioners', 'clinic_not_live', 'bad_name', 'owner_only', 'bad_kind', 'kind_locked',
    'bad_request', 'not_configured',
];

/** The exception name a function raised, or 'unknown'. */
export function errorCode(message: string | undefined | null): string {
    if (!message) return 'unknown';
    return KNOWN.find((k) => message.includes(k)) ?? 'unknown';
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> {
    if (!supabase) return { data: null, error: 'unknown' };
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { data: null, error: errorCode(error.message) };
    return { data: data as T, error: null };
}

export const teamOverview = (clinicId: string) =>
    call<TeamOverview>('team_overview', { p_clinic: clinicId });

export const revokeInvite = (inviteId: string) =>
    call<null>('team_revoke_invite', { p_invite: inviteId });

export const setMemberRole = (clinicId: string, userId: string, role: TeamRole) =>
    call<null>('team_set_role', { p_clinic: clinicId, p_user: userId, p_role: role });

export const removeMember = (clinicId: string, userId: string) =>
    call<null>('team_remove_member', { p_clinic: clinicId, p_user: userId });

export const linkPractitioner = (clinicId: string, practitionerId: string) =>
    call<{ status: 'active' | 'pending'; managed: boolean }>('practitioner_link', {
        p_clinic: clinicId, p_practitioner: practitionerId,
    });

export const createPractitioner = (clinicId: string, name: string, specialty: string[]) =>
    call<{ provider_id: string; repeat?: boolean }>('practitioner_create', {
        p_clinic: clinicId, p_name: name, p_specialty: specialty,
    });

export const unlinkPractitioner = (clinicId: string, practitionerId: string) =>
    call<null>('practitioner_unlink', { p_clinic: clinicId, p_practitioner: practitionerId });

/** The specialist's side: accept/decline a clinic, or let it (not) edit the listing. */
export const updatePractitionerLink = (
    clinicId: string,
    practitionerId: string,
    change: { accept?: boolean; managed?: boolean },
) =>
    call<null>('practitioner_update_link', {
        p_clinic: clinicId,
        p_practitioner: practitionerId,
        p_accept: change.accept ?? null,
        p_managed: change.managed ?? null,
    });

export const invitePreview = (token: string) =>
    call<InvitePreview>('invite_preview', { p_token: token });

/**
 * 'accepted': you joined a clinic's team. 'claim': a clinic invited you to
 * your own listing, which still goes through claim review (/claim/<id>).
 */
export const acceptInvite = (token: string) =>
    call<{ status: 'accepted' | 'claim'; provider_id: string; invite_id?: string }>('invite_accept', { p_token: token });

export const dismissSuggestion = (clinicId: string, practitionerId: string) =>
    call<null>('practitioner_suggestion_dismiss', { p_clinic: clinicId, p_practitioner: practitionerId });

/** Say whether a listing is a clinic (several doctors) or one doctor. */
export const setListingKind = (providerId: string, kind: 'clinic' | null) =>
    call<null>('set_listing_kind', { p_id: providerId, p_kind: kind });

export interface DirectoryMatch {
    id: string;
    name: string;
    address: string;
    city: string;
    specialty: string[];
    imageUrl: string | null;
    owned: boolean;
}

/**
 * Listings in the directory that look like this name. Reuses the onboarding
 * matcher (bh_match_providers), which already ignores titles like "Dra." and
 * never returns contact details.
 */
export async function searchDirectory(name: string, city?: string): Promise<DirectoryMatch[]> {
    if (!supabase || name.trim().length < 3) return [];
    const { data } = await supabase.rpc('bh_match_providers', {
        p_name: name, p_org: null, p_phone: null, p_email: null, p_city: city ?? null,
    });
    return (data ?? []) as DirectoryMatch[];
}

export interface SentInvite {
    link: string;
    emailed: boolean;
}

/**
 * Create an invite and email it. The server creates it as the signed-in user
 * (so the same team check applies) and sends the email; the link comes back
 * either way, so the dashboard can offer it for WhatsApp when email fails.
 */
export async function sendInvite(args: {
    clinicId: string;
    email: string;
    role: TeamRole;
    providerId?: string;
    lang: string;
}): Promise<Result<SentInvite>> {
    if (!supabase) return { data: null, error: 'unknown' };
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { data: null, error: 'not_signed_in' };
    try {
        const res = await fetch('/api/team-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify(args),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { data: null, error: errorCode(body?.error) };
        return { data: { link: body.link, emailed: !!body.emailed }, error: null };
    } catch {
        return { data: null, error: 'unknown' };
    }
}

/**
 * Tell a doctor who runs their own listing that a clinic wants to list them.
 * Best effort: the link is already pending in their dashboard either way.
 */
export async function sendLinkNotice(clinicId: string, practitionerId: string): Promise<void> {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
        await fetch('/api/team-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ action: 'link-notice', clinicId, providerId: practitionerId }),
        });
    } catch {
        // The pending link in their dashboard is the record; the e-mail is a courtesy.
    }
}
