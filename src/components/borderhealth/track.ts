/**
 * Funnel tracking for the /borderhealth forms. Events go to /api/form-event
 * (table `form_events`). Tracking is fire-and-forget: it can never throw, block,
 * or slow a form. No answers or contact details are ever sent here; those only
 * travel with the real submission.
 */
import { getClientId, getRef, getSession } from './submit';
import { track as capture } from '../../lib/posthog';
import type { BhLang, BhSegment } from './types';

export type FormEvent =
    | 'page_view' | 'segment_selected' | 'segment_changed' | 'step_view' | 'first_answer' | 'step_next'
    | 'validation_error' | 'lang_switch' | 'submit_attempt' | 'submit_success' | 'submit_error' | 'abandon';

export interface TrackFields {
    form_segment?: BhSegment | null;
    lang?: BhLang;
    step?: number;
    step_id?: string;
    submission_key?: string | null;
    props?: Record<string, unknown>;
}

const VISIT_KEY = 'ms_bh_visit';
let visitFallback: string | null = null;

function rid(): string {
    try {
        if (crypto.randomUUID) return crypto.randomUUID();
    } catch { /* fall through */ }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function visitId(): string {
    try {
        let v = sessionStorage.getItem(VISIT_KEY);
        if (!v) {
            v = rid();
            sessionStorage.setItem(VISIT_KEY, v);
        }
        return v;
    } catch {
        return (visitFallback ??= rid());
    }
}

function device() {
    const ua = navigator.userAgent || '';
    const device_type = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|iphone|android/i.test(ua) ? 'mobile' : 'desktop';
    const browser = /edg\//i.test(ua) ? 'Edge'
        : /opr\/|opera/i.test(ua) ? 'Opera'
        : /samsungbrowser/i.test(ua) ? 'Samsung'
        : /fban|fbav|instagram/i.test(ua) ? 'Facebook/Instagram app'
        : /chrome|crios/i.test(ua) ? 'Chrome'
        : /firefox|fxios/i.test(ua) ? 'Firefox'
        : /safari/i.test(ua) ? 'Safari' : 'Other';
    const os = /windows/i.test(ua) ? 'Windows'
        : /iphone|ipad|ipod/i.test(ua) ? 'iOS'
        : /android/i.test(ua) ? 'Android'
        : /mac os/i.test(ua) ? 'macOS'
        : /cros/i.test(ua) ? 'ChromeOS'
        : /linux/i.test(ua) ? 'Linux' : 'Other';
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
    return {
        device_type, browser, os,
        screen_w: window.screen?.width, screen_h: window.screen?.height,
        viewport_w: window.innerWidth, viewport_h: window.innerHeight,
        dpr: window.devicePixelRatio,
        tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })(),
        browser_lang: navigator.language,
        connection: conn?.effectiveType,
    };
}

export function track(event: FormEvent, fields: TrackFields = {}): void {
    try {
        const q = new URLSearchParams(window.location.search);
        const payload: Record<string, unknown> = {
            event,
            ...fields,
            visitor_id: getClientId(),
            visit_id: visitId(),
            session: getSession(window.location.search),
            ref: getRef(window.location.search),
            page_path: window.location.pathname,
            page_query: window.location.search.slice(1),
            utm_source: q.get('utm_source'),
            utm_medium: q.get('utm_medium'),
            utm_campaign: q.get('utm_campaign'),
            utm_content: q.get('utm_content'),
            utm_term: q.get('utm_term'),
        };
        if (event === 'page_view') {
            payload.referrer = document.referrer || null;
            Object.assign(payload, device());
        }
        // Mirror to PostHog (same no-answers rule as above) so the survey funnel
        // sits beside the rest of the product funnel. form_events stays the
        // source of truth.
        capture(`bh_${event}`, {
            form_segment: fields.form_segment, lang: fields.lang, step: fields.step, step_id: fields.step_id,
            ...fields.props, utm_source: payload.utm_source, utm_medium: payload.utm_medium,
            utm_campaign: payload.utm_campaign, ref: payload.ref,
        });
        const body = JSON.stringify(payload);
        if (navigator.sendBeacon && navigator.sendBeacon('/api/form-event', new Blob([body], { type: 'application/json' }))) return;
        void fetch('/api/form-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
        }).catch(() => { /* tracking must never surface an error */ });
    } catch { /* ignore */ }
}
