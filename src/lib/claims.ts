import { supabase } from './supabase';
import { track } from './posthog';

/**
 * Claiming a listing (migration 0047). Nothing here grants anything: the
 * claimant uploads documents into their own folder of a private bucket and
 * calls `claim_submit`, which checks the claim is complete and puts it in the
 * review queue. A person approves it in /admin.
 */

export type ClaimRole = 'doctor' | 'owner' | 'manager';
export type DocKind = 'government_id' | 'cedula' | 'license' | 'business_proof' | 'authorization_letter' | 'other';
export type ClaimState = 'incomplete' | 'pending' | 'needs_info' | 'approved' | 'rejected';

export interface MyClaim {
    id: string;
    provider_id: string;
    status: ClaimState;
    claimant_role: ClaimRole | null;
    created_at: string;
    submitted_at: string | null;
    reviewed_at: string | null;
    review_note: string | null;
}

export interface ClaimInput {
    providerId: string;
    role: ClaimRole;
    legalName: string;
    phone: string;
    cedula?: string;
    npi?: string;
    licenseNumber?: string;
    licenseState?: string;
    rfc?: string;
    note?: string;
    documents: { kind: DocKind; path: string }[];
    consent: boolean;
}

export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export const DOC_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';

/** Which documents a claim needs, by role and the listing's country. Mirrors claim_submit. */
export function requiredDocs(role: ClaimRole, country: 'MX' | 'US'): DocKind[] {
    if (role === 'doctor') return ['government_id', country === 'MX' ? 'cedula' : 'license'];
    if (role === 'owner') return ['government_id', 'business_proof'];
    return ['government_id', 'authorization_letter'];
}

/** NPI check digit: Luhn over "80840" + the ten digits. Mirrors npi_valid(). */
export function npiValid(npi: string): boolean {
    if (!/^\d{10}$/.test(npi)) return false;
    const s = `80840${npi}`;
    let total = 0;
    for (let i = 0; i < s.length; i++) {
        let d = Number(s[s.length - 1 - i]);
        if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
        total += d;
    }
    return total % 10 === 0;
}

export async function fetchMyClaim(providerId: string): Promise<MyClaim | null> {
    if (!supabase) return null;
    const { data } = await supabase
        .from('provider_claims')
        .select('id, provider_id, status, claimant_role, created_at, submitted_at, reviewed_at, review_note')
        .eq('provider_id', providerId)
        .maybeSingle();
    return (data as MyClaim | null) ?? null;
}

/** Uploads one file into <user>/<listing>/ of the private bucket; returns its path. */
export async function uploadClaimDocument(userId: string, providerId: string, kind: DocKind, file: File): Promise<string> {
    if (!supabase) throw new Error('not_configured');
    if (file.size > MAX_DOC_BYTES) throw new Error('file_too_large');
    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
    const path = `${userId}/${providerId}/${kind}-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('claim-documents').upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
    });
    if (error) throw new Error(/mime|type/i.test(error.message) ? 'file_type' : 'upload_failed');
    return path;
}

/**
 * Error codes raised by claim_submit, plus the upload ones above. The page
 * turns each into a sentence; anything unknown shows a generic one.
 */
export const CLAIM_ERRORS = [
    'not_signed_in', 'email_not_confirmed', 'consent_required', 'bad_role', 'bad_legal_name', 'bad_phone',
    'bad_documents', 'listing_not_found', 'recently_rejected', 'too_many_claims', 'cedula_required', 'npi_invalid',
    'license_required', 'bad_cedula', 'bad_rfc', 'bad_document', 'id_document_required', 'cedula_document_required',
    'license_document_required', 'business_document_required', 'authorization_required',
    'file_too_large', 'file_type', 'upload_failed',
] as const;
export type ClaimError = (typeof CLAIM_ERRORS)[number] | 'unknown';

export function claimErrorCode(message: string): ClaimError {
    return CLAIM_ERRORS.find((c) => message.includes(c)) ?? 'unknown';
}

/**
 * Asks api/claim-notify to send whatever the database just queued (0048). Fire
 * and forget: if it fails, the daily cron sends the e-mail instead.
 */
export async function pingClaimEmails(): Promise<void> {
    if (!supabase) return;
    try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        await fetch('/api/claim-notify', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, keepalive: true });
    } catch { /* the cron catches it */ }
}

export async function submitClaim(input: ClaimInput): Promise<{ status: 'pending' | 'owner' } | { error: ClaimError }> {
    if (!supabase) return { error: 'unknown' };
    const { data, error } = await supabase.rpc('claim_submit', {
        p_provider: input.providerId,
        p_role: input.role,
        p_legal_name: input.legalName,
        p_phone: input.phone,
        p_cedula: input.cedula || null,
        p_npi: input.npi || null,
        p_license_number: input.licenseNumber || null,
        p_license_state: input.licenseState || null,
        p_rfc: input.rfc || null,
        p_evidence: input.note || null,
        p_documents: input.documents,
        p_consent: input.consent,
    });
    const status = (data as { status?: string } | null)?.status;
    track('claim_submitted', { provider_id: input.providerId, role: input.role, ok: !error, status });
    if (error) return { error: claimErrorCode(error.message) };
    if (status === 'pending') void pingClaimEmails();
    if (status === 'pending' || status === 'owner') return { status };
    return { error: 'unknown' };
}
