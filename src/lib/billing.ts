import { supabase } from './supabase';

export type PlanKey = 'promoted' | 'featured';
export type Market = 'us' | 'mx';

export const PLAN_MARKET_KEY = 'ms_plan_market';

export const marketForLanguage = (lang: string): Market => (lang.toLowerCase().startsWith('es') ? 'mx' : 'us');

/**
 * Reads the clinic's preferred billing market from localStorage under 'ms_plan_market'.
 * Returns null if storage fails or the stored value is neither 'us' nor 'mx'.
 */
export function readSavedMarket(): Market | null {
    try {
        const val = localStorage.getItem(PLAN_MARKET_KEY);
        if (val === 'us' || val === 'mx') return val;
    } catch {
        // Storage access may fail (blocked, quota, private browsing)
    }
    return null;
}

/**
 * Saves the chosen billing market to localStorage under 'ms_plan_market'.
 */
export function saveChosenMarket(market: Market): void {
    try {
        localStorage.setItem(PLAN_MARKET_KEY, market);
    } catch {
        // Ignore storage write failures
    }
}

/** A failed call to our billing endpoints; `code` is the server's error name. */
export class BillingError extends Error {
    code: string;
    constructor(code: string) {
        super(code);
        this.code = code;
    }
}

/** Calls a signed-in billing endpoint and returns the Stripe page to send the owner to. */
async function openStripe(job: 'stripe-checkout' | 'stripe-portal', body: Record<string, string>): Promise<string> {
    if (!supabase) throw new BillingError('offline');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new BillingError('unauthorized');
    const r = await fetch(`/api/billing?job=${job}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = (await r.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!r.ok || !json?.url) throw new BillingError(json?.error ?? 'failed');
    return json.url;
}

/**
 * Stripe Checkout for this listing, plan and market. The server confirms the
 * signed-in account owns the listing and ties the payment to it, so nothing is
 * matched by email. The plan switches on when Stripe tells the server the
 * invoice is paid; the Plan tab only waits for that.
 */
export const startCheckout = (providerId: string, plan: PlanKey, market: Market): Promise<string> =>
    openStripe('stripe-checkout', { provider_id: providerId, plan, market });

/** Stripe's customer portal for this listing: switch plan, update the card, cancel. */
export const openPortal = (providerId: string): Promise<string> =>
    openStripe('stripe-portal', { provider_id: providerId });

export interface PlanStatusRow {
    plan: PlanKey;
    status: 'active' | 'canceled' | 'refunded' | 'lapsed' | 'comp';
    paid_through: string | null;
    market: Market | null;
    access: boolean;
    /** True when this plan is paid through Stripe, so the customer portal can manage it. */
    stripe?: boolean;
}

/** This listing's subscriptions, owners only (enforced in the database). */
export async function fetchPlanStatus(providerId: string): Promise<PlanStatusRow[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.rpc('my_plan_status', { p_provider: providerId });
    if (error || !Array.isArray(data)) return [];
    return data as PlanStatusRow[];
}
