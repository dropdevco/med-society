/**
 * Where a visit came from, decided once per browser session.
 *
 * A single-page app only sees `document.referrer` and the UTM tags on the very
 * first load; by the time someone opens a profile the URL is clean again. So the
 * channel is worked out at the start of the session, kept in sessionStorage, and
 * registered on every event after it. That is what lets a doctor be told "most
 * of your visitors arrive from WhatsApp shares" instead of "direct".
 *
 * What is kept is deliberately coarse: a channel label, the referring *hostname*
 * (never the path or query, which can carry anything) and the campaign tags the
 * team put on its own links.
 */

export type Channel =
    | 'direct' | 'search' | 'ai' | 'social' | 'whatsapp' | 'email' | 'paid' | 'referral' | 'internal';

export interface Attribution {
    channel: Channel;
    /** Referring hostname without `www.`, or the utm_source when there is one. */
    channel_source?: string;
    utm_campaign?: string;
}

const KEY = 'ms_attribution';

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|baidu|yandex|startpage)\./;
// AI assistants that send people to us as a citation or a search result.
const AI = /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|you\.com|poe\.com|grok\.com|meta\.ai|phind\.com|kagi\.com)$/;
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|l\.facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|t\.co|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|reddit\.com|pinterest\.com|threads\.net)$/;
const WHATSAPP = /(^|\.)(wa\.me|whatsapp\.com|web\.whatsapp\.com)$/;

function clip(v: string | null | undefined, max = 40): string | undefined {
    const s = (v ?? '').trim().toLowerCase();
    return s ? s.slice(0, max) : undefined;
}

/** Classify a hostname (already lower-cased, without `www.`). */
function byHost(host: string): Channel {
    if (AI.test(host)) return 'ai';
    if (WHATSAPP.test(host)) return 'whatsapp';
    if (SOCIAL.test(host)) return 'social';
    if (SEARCH.test(host)) return 'search';
    return 'referral';
}

/** Pure, so it can be tested without a browser. */
export function classifyVisit(
    referrer: string,
    search: string,
    ownHost: string,
): Attribution {
    const q = new URLSearchParams(search);
    const medium = clip(q.get('utm_medium'));
    const source = clip(q.get('utm_source'));
    const campaign = clip(q.get('utm_campaign'));

    let host = '';
    try { host = referrer ? new URL(referrer).hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { /* ignore */ }

    const base = { ...(campaign ? { utm_campaign: campaign } : {}) };

    // Our own tags win over the referrer: a newsletter link opened in Gmail has
    // a Gmail referrer, and the campaign is what the team actually wants to see.
    if (medium && /^(email|e-mail|newsletter)$/.test(medium)) return { channel: 'email', channel_source: source ?? host ?? undefined, ...base };
    if (medium && /^(cpc|ppc|paid|paidsocial|paid_social|display)$/.test(medium)) return { channel: 'paid', channel_source: source, ...base };
    // ChatGPT appends utm_source=chatgpt.com to links it cites.
    if (source && AI.test(source)) return { channel: 'ai', channel_source: source, ...base };
    if (source === 'whatsapp') return { channel: 'whatsapp', channel_source: 'whatsapp', ...base };
    if (source && /^(facebook|instagram|tiktok|twitter|x|linkedin|youtube)$/.test(source)) {
        return { channel: 'social', channel_source: source, ...base };
    }

    if (!host) return { channel: 'direct', ...(source ? { channel_source: source } : {}), ...base };
    if (host === ownHost.replace(/^www\./, '')) return { channel: 'internal', ...base };
    return { channel: byHost(host), channel_source: host, ...base };
}

/**
 * The attribution for this session. Computed on first call, then served from
 * sessionStorage so navigating inside the app never rewrites it. A visit that
 * starts as `internal` (a refresh deep inside the app) reads as `direct`.
 */
export function sessionAttribution(): Attribution {
    try {
        const saved = sessionStorage.getItem(KEY);
        if (saved) return JSON.parse(saved) as Attribution;
    } catch { /* storage blocked: fall through and compute per load */ }

    const found = classifyVisit(document.referrer, window.location.search, window.location.hostname);
    const attribution: Attribution = found.channel === 'internal' ? { channel: 'direct' } : found;
    try { sessionStorage.setItem(KEY, JSON.stringify(attribution)); } catch { /* ignore */ }
    return attribution;
}
