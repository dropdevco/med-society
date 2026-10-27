import { useEffect } from 'react';
import type { Provider } from '../types/provider';
import { trackSectionView, type ProfileSection } from '../utils/analytics';

/**
 * Reports which parts of a profile a visitor actually reached.
 *
 * Marks are `data-section="…"` on wrappers inside the element carrying
 * `data-provider-id`. A section counts once per profile view, when half of it
 * is on screen — not on load, because the map and reviews sit far below the
 * fold and "it was in the page" says nothing about whether anyone read it.
 *
 * This is what lets a doctor be told "61% of people who opened your profile
 * reached your reviews but only 9% reached the inquiry form".
 */
export function useSectionViews(provider: Provider): void {
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const root = document.querySelector(`[data-provider-id="${provider.id}"]`);
        if (!root) return;

        const seen = new Set<string>();
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                // Half of it on screen, or — for a section taller than the
                // screen, which can never be half visible — a good slice of
                // the screen filled with it.
                const reached = entry.intersectionRatio >= 0.5
                    || entry.intersectionRect.height >= window.innerHeight * 0.4;
                if (!reached) continue;
                const section = (entry.target as HTMLElement).dataset.section as ProfileSection | undefined;
                if (!section || seen.has(section)) continue;
                seen.add(section);
                trackSectionView(provider, section);
                observer.unobserve(entry.target);
            }
        }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

        root.querySelectorAll('[data-section]').forEach((el) => observer.observe(el));
        return () => observer.disconnect();
        // Re-armed only for a different provider; the wrappers are always present.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider.id]);
}
