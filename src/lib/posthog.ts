import posthog from 'posthog-js';

/**
 * PostHog product analytics.
 *
 * Everything here is a no-op when `VITE_POSTHOG_KEY` is unset (local dev, forks,
 * previews without the variable), and every call is wrapped so analytics can
 * never throw into, block, or slow a page.
 *
 * This is a medical directory, so the rule for what goes in an event is: ids,
 * counts, booleans and enum-like labels only. Never the text of a search or
 * symptom description, an inquiry message, a name, an email or a phone number.
 * Session replay is off for the same reason.
 *
 * In production events go through `/ingest` (a Vercel rewrite to PostHog, see
 * vercel.json) so ad blockers that match posthog.com do not drop them.
 */

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';
const UI_HOST = HOST.includes('eu.') ? 'https://eu.posthog.com' : 'https://us.posthog.com';

let ready = false;

export function initAnalytics(language?: string): void {
    if (ready || !KEY || typeof window === 'undefined') return;
    try {
        posthog.init(KEY, {
            api_host: import.meta.env.PROD ? '/ingest' : HOST,
            ui_host: UI_HOST,
            // Pageviews are sent by <AnalyticsBridge> on every route change;
            // the default only sees the first load of a single-page app.
            capture_pageview: false,
            capture_pageleave: true,
            // Anonymous visitors do not get a person profile (cheaper, and
            // nothing is stored about someone who never signs in). Signing in
            // calls identify(), which creates one.
            person_profiles: 'identified_only',
            respect_dnt: true,
            disable_session_recording: true,
            // Keep what autocapture records from carrying page text.
            mask_all_text: false,
            mask_all_element_attributes: false,
            persistence: 'localStorage+cookie',
            // With a key in .env.local, `npm run dev` prints every event to the console.
            loaded: (ph) => { if (import.meta.env.DEV) ph.debug(); },
        });
        ready = true;
        posthog.register({
            app: 'medsociety-marketplace',
            build: import.meta.env.VITE_APP_BUILD_ID,
            ...(language ? { lang: language } : {}),
        });
    } catch { /* analytics must never break the app */ }
}

/** Properties attached to every event until changed (language, border region…). */
export function setContext(props: Record<string, unknown>): void {
    if (!ready) return;
    try { posthog.register(props); } catch { /* ignore */ }
}

export function identifyUser(id: string, props?: Record<string, unknown>): void {
    if (!ready) return;
    try { posthog.identify(id, props); } catch { /* ignore */ }
}

/** PostHog's id for this visitor, so a feedback report can be found next to their events. */
export function distinctId(): string | undefined {
    if (!ready) return undefined;
    try { return posthog.get_distinct_id(); } catch { return undefined; }
}

export function resetIdentity(): void {
    if (!ready) return;
    try { posthog.reset(); } catch { /* ignore */ }
}

export function capturePageview(props: Record<string, unknown>): void {
    if (!ready) return;
    try { posthog.capture('$pageview', props); } catch { /* ignore */ }
}

/** Every custom event the app sends. Adding one here keeps the dashboard honest. */
export type AppEvent =
    | 'search_performed'
    | 'provider_clicked'
    | 'provider_contact_click'
    | 'inquiry_sent'
    | 'inquiry_failed'
    | 'inquiry_login_prompt'
    | 'sign_in'
    | 'sign_up'
    | 'sign_out'
    | 'claim_submitted'
    | 'pricing_cta_click'
    | 'checkout_started'
    | 'checkout_failed'
    | 'forum_thread_created'
    | 'forum_reply_created'
    | 'forum_helpful_marked'
    | 'language_changed'
    | 'feedback_opened'
    | 'feedback_submitted'
    | 'feedback_failed'
    | `bh_${string}`;

export function track(event: AppEvent, props?: Record<string, unknown>): void {
    if (!ready) return;
    try { posthog.capture(event, props); } catch { /* ignore */ }
}
