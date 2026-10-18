import { supabase } from './supabase';

export type PlanKey = 'promoted' | 'featured';
export type Market = 'us' | 'mx';

/**
 * The four GoHighLevel payment links, one per plan and market. The English site
 * sells in the `us` product, the Spanish site in the `mx` one.
 *
 * Changing a price means a new link: replace the URL here, nothing else moves.
 * The server does not care which link was used (api/billing.ts reads the plan
 * and market the GHL workflow reports), so keep this table and the workflows in
 * step.
 */
export const PAYMENT_LINKS: Record<PlanKey, Record<Market, string>> = {
    promoted: {
        us: 'https://links.mylayerone.com/payment-link/6acdc4e3c0e70c7fefb74389',
        mx: 'https://links.mylayerone.com/payment-link/6acdecaf075ea22a20cde1be',
    },
    featured: {
        us: 'https://links.mylayerone.com/payment-link/6acdec8b075ea22a20cde1bd',
        mx: 'https://links.mylayerone.com/payment-link/6acdec54075ea22a20cde1bc',
    },
};

export const marketForLanguage = (lang: string): Market => (lang.toLowerCase().startsWith('es') ? 'mx' : 'us');

/**
 * The payment page, pre-filled with the signed-in email (GHL payment links take
 * `email`, `firstName`, `lastName`, `phone`) so the payment arrives under the
 * address we can match to the account. `redirectUrl` brings them back to the
 * Plan tab, which waits for the plan to switch on.
 */
export function checkoutUrl(plan: PlanKey, market: Market, email: string, origin = window.location.origin): string {
    const u = new URL(PAYMENT_LINKS[plan][market]);
    if (email) u.searchParams.set('email', email);
    u.searchParams.set('redirectIn', '4');
    u.searchParams.set('redirectUrl', `${origin}/dashboard?tab=plan&paid=${plan}`);
    return u.toString();
}

/**
 * Records "this account is paying for this listing" and returns the payment page.
 * The intent is what ties an otherwise anonymous payment to a listing, so it is
 * recorded first; if that call fails the payment can still be matched by the
 * account email, so it does not block the purchase.
 */
export async function startCheckout(providerId: string, plan: PlanKey, lang: string, email: string): Promise<string> {
    const market = marketForLanguage(lang);
    if (supabase) {
        const { error } = await supabase.rpc('start_plan_checkout', { p_provider: providerId, p_plan: plan, p_market: market });
        if (error) console.error('start_plan_checkout failed:', error.message);
    }
    return checkoutUrl(plan, market, email);
}

export interface PlanStatusRow {
    plan: PlanKey;
    status: 'active' | 'canceled' | 'refunded' | 'lapsed' | 'comp';
    paid_through: string | null;
    market: Market | null;
    access: boolean;
}

/** This listing's subscriptions, owners only (enforced in the database). */
export async function fetchPlanStatus(providerId: string): Promise<PlanStatusRow[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.rpc('my_plan_status', { p_provider: providerId });
    if (error || !Array.isArray(data)) return [];
    return data as PlanStatusRow[];
}
