import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { capturePageview, identifyUser, resetIdentity, setContext, track } from '../lib/posthog';
import { sessionAttribution } from '../lib/attribution';

/**
 * Renders nothing. Lives inside the router and feeds PostHog the three things
 * a single-page app does not report on its own: route changes, who is signed
 * in, and the UI language.
 */
export function AnalyticsBridge() {
    const location = useLocation();
    const { i18n } = useTranslation();
    const { user, loading } = useSession();

    // Where this visit came from, registered before the first $pageview below
    // so every event of the session carries it (see lib/attribution.ts).
    useEffect(() => {
        const { channel, channel_source, utm_campaign } = sessionAttribution();
        setContext({ channel, channel_source: channel_source ?? null, utm_campaign: utm_campaign ?? null });
    }, []);

    // One $pageview per path. Query-only changes (search filters, the region the
    // home page appends to its own URL) are the same page, not a new view. A
    // provider opened as a modal over the search page is a real path change, so
    // it counts, but `modal` lets reports separate it from a direct visit.
    const last = useRef('');
    useEffect(() => {
        if (location.pathname === last.current) return;
        last.current = location.pathname;
        const modal = Boolean((location.state as { backgroundLocation?: unknown } | null)?.backgroundLocation);
        capturePageview({ path: location.pathname, modal });
    }, [location]);

    // Identify on sign-in; reset when a signed-in user signs out so the next
    // person on a shared device is not stitched to the previous one. The id is
    // the Supabase user id; no email or name is sent.
    const wasSignedIn = useRef(false);
    useEffect(() => {
        if (loading) return;
        if (user) {
            identifyUser(user.id);
            wasSignedIn.current = true;
        } else if (wasSignedIn.current) {
            wasSignedIn.current = false;
            resetIdentity();
        }
    }, [user, loading]);

    useEffect(() => {
        const apply = (lng: string) => setContext({ lang: lng.startsWith('es') ? 'es' : 'en' });
        apply(i18n.language || 'en');
        const onChange = (lng: string) => {
            apply(lng);
            track('language_changed', { to: lng.startsWith('es') ? 'es' : 'en' });
        };
        i18n.on('languageChanged', onChange);
        return () => { i18n.off('languageChanged', onChange); };
    }, [i18n]);

    return null;
}
