import type { Provider } from '../types/provider';
import { isNewListing } from './profileViews';

/**
 * A modelled estimate of how much attention a listing is getting.
 *
 * This exists as a sales argument: a clinic that has never heard of us needs a
 * reason to care that its profile is here, and "two hundred people looked at
 * this page and none of them could find a way to contact you" is that reason.
 *
 * Two things about it are deliberate and should not be quietly changed.
 *
 * It is **never rendered on a public page**. Presenting a modelled number to
 * patients as if it were measured traffic would be a straightforward
 * misrepresentation, and the whole value of the directory is that what it says
 * about a clinic is true. It appears in the clinic's own dashboard, labelled
 * as an estimate, and nowhere else.
 *
 * It is **deterministic**. Seeded from the provider id, so the same listing
 * shows the same number on every render, on every device, to every viewer.
 * A figure that drifts between reloads is not an estimate, it is a slot
 * machine, and the first clinic to notice would be right to stop trusting us.
 *
 * Replace this with `providers.clicks` the moment click tracking is persisted
 * — analytics.ts already has the TODO. Real numbers that start small beat
 * modelled numbers that start flattering.
 */

/** FNV-1a. Small, stable, and dependency-free — all this needs. */
function hash(id: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) / 0xffffffff;
}

export interface ViewEstimate {
    /** Estimated profile views in the last 30 days. */
    views: number;
    /** Estimated taps on a phone number or message in the same window. */
    contacts: number;
}

export function estimateViews(p: Provider): ViewEstimate {
    // A listing created through the sign-up form has no history: nobody has
    // seen it yet, so no modelled baseline either.
    if (isNewListing(p)) return { views: 0, contacts: 0 };

    // Review count is the only real demand signal we hold: a clinic with eight
    // hundred reviews genuinely is searched for more than one with four. The
    // log keeps the top of the range plausible rather than letting the busiest
    // listing claim tens of thousands of views.
    const demand = Math.log1p(Math.max(0, p.reviewCount || 0)) / Math.log1p(1500);

    // A listing with a real photo does get opened more often; a promoted one
    // is shown more often. Both are small multipliers, not the main term.
    const photographed = p.imageUrl ? 1.15 : 1;
    const placement = p.tier === 'basic' ? 1 : 1.6;

    const jitter = 0.85 + hash(p.id) * 0.3;
    const views = Math.round(40 + demand * 420 * photographed * placement * jitter);

    // Contacts are the point: a free listing has no contact button, so the
    // dashboard's headline is a gap, not a number to be proud of.
    const contacts = p.tier === 'basic' ? 0 : Math.round(views * 0.06);

    return { views, contacts };
}
