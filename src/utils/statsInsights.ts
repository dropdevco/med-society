import type { Provider } from '../types/provider';
import type { ProviderStats } from '../hooks/useProviderStats';
import type { CompletenessTarget } from './profileCompleteness';
import { MIN_GALLERY_PHOTOS, hasOwnAvatar } from './profileCompleteness';
import { termLabel } from './termLabels';

/**
 * Plain-language suggestions drawn from a clinic's own numbers.
 *
 * Rules, not a model: each one is a comparison a person could check by hand,
 * with a threshold that keeps it from firing on noise, and each says what to do
 * and where. They are the "personalised" part of the analytics: the same
 * dashboard says different things to a clinic that is seen and not contacted
 * than to one whose visitors browse in a language its profile does not speak.
 *
 * Copy lives in the locale files under `analytics.insight.<id>`; this returns
 * the id, the numbers to fill in, and where the fix lives.
 */
export interface Insight {
    id: string;
    params: Record<string, string | number>;
    /** Where the clinic goes to act on it, if there is somewhere. */
    target?: CompletenessTarget;
    /** Higher shows first. */
    weight: number;
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

export function buildInsights(
    clinic: Provider,
    stats: ProviderStats,
    galleryCount: number,
    lang: string,
): Insight[] {
    const out: Insight[] = [];
    const views = stats.totals?.views ?? stats.views_30d ?? 0;
    const contacts = stats.totals?.contacts ?? null;

    // Seen a lot, never contacted: the single most useful thing to tell a clinic.
    if (contacts === 0 && views >= 30) {
        out.push({ id: 'seenNotContacted', params: { views }, target: { tab: 'profile', field: 'acct-phone' }, weight: 100 });
    }

    // People look at the profile but few reach the form that is the page's main action.
    const reachedInquiry = stats.sections?.inquiry ?? null;
    if (reachedInquiry !== null && views >= 50 && pct(reachedInquiry, views) < 15) {
        out.push({ id: 'inquiryNotReached', params: { share: pct(reachedInquiry, views) }, weight: 60 });
    }

    // Visitors who browse in Spanish, a profile that never says it speaks it (and the reverse).
    const langTotal = Object.values(stats.langs ?? {}).reduce((a, b) => a + b, 0);
    if (langTotal >= 30) {
        for (const code of ['es', 'en'] as const) {
            const share = pct(stats.langs?.[code] ?? 0, langTotal);
            if (share >= 30 && !clinic.languages.includes(code)) {
                out.push({
                    id: code === 'es' ? 'visitorsSpanish' : 'visitorsEnglish',
                    params: { share },
                    target: { tab: 'profile', field: 'acct-languages' },
                    weight: 80,
                });
            }
        }
    }

    // A third of searches in this specialty filter by insurance; the profile lists none.
    const d = stats.demand;
    if (d && d.searches >= 20) {
        const insuranceShare = pct(d.filters.insurance ?? 0, d.searches);
        if (insuranceShare >= 25 && (clinic.insurances?.length ?? 0) === 0) {
            out.push({ id: 'insuranceDemand', params: { share: insuranceShare }, weight: 75 });
        }
        // The most-searched service in the specialty, when the profile never mentions it.
        const top = d.terms[0];
        if (top && top.searches >= 5) {
            const label = termLabel(top.term, lang);
            const names = [...(clinic.serviceNames ?? []), ...(clinic.services ?? []).map((s) => s.name)]
                .join(' ').toLowerCase();
            const first = label.toLowerCase().split(/[\s/&]+/)[0];
            if (first.length > 3 && !names.includes(first)) {
                out.push({ id: 'topServiceMissing', params: { service: label, searches: top.searches }, target: { tab: 'profile' }, weight: 55 });
            }
        }
        // More people searching than there are answers.
        if (d.searches >= 20 && pct(d.no_results, d.searches) >= 20) {
            out.push({ id: 'unmetDemand', params: { searches: d.searches, share: pct(d.no_results, d.searches) }, weight: 40 });
        }
    }

    // Profile gaps worth naming even without traffic data.
    if (galleryCount < MIN_GALLERY_PHOTOS && !hasOwnAvatar(clinic)) {
        out.push({ id: 'photos', params: {}, target: { tab: 'photos' }, weight: 50 });
    }

    // When to be at the phone.
    const hours = stats.by_hour ?? [];
    const total = hours.reduce((a, b) => a + b, 0);
    if (hours.length === 24 && total >= 50) {
        // The best three-hour window.
        let best = 0;
        let bestSum = -1;
        for (let h = 0; h < 22; h++) {
            const s = hours[h] + hours[h + 1] + hours[h + 2];
            if (s > bestSum) { bestSum = s; best = h; }
        }
        out.push({ id: 'peakHours', params: { from: best, to: best + 3, share: pct(bestSum, total) }, weight: 20 });
    }

    return out.sort((a, b) => b.weight - a.weight).slice(0, 4);
}
