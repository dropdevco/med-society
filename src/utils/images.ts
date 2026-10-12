/**
 * Portrait handling for provider cards.
 *
 * The scrape filled `imageUrl` for two thirds of the directory, but 1,673 of
 * those rows point at the same Doctoralia Open Graph banner — the image the
 * source site serves when a profile has no photo at all. Treating it as a
 * portrait would wallpaper the whole browse view with one logo, which is worse
 * than showing no photo, so it is filtered out here rather than in each card.
 * The same goes for Doctoralia's generic grey "default doctor" silhouette
 * (`doctor-default_large.jpg`, 44 listings), which is a placeholder wearing a
 * portrait's clothes.
 */

const PLACEHOLDER = /open-graph|\/og\.png|(?:doctor|facility)-default/i;

/** A usable portrait URL, or undefined when there is nothing worth showing. */
export function portraitUrl(raw?: string): string | undefined {
    if (!raw) return undefined;
    if (PLACEHOLDER.test(raw)) return undefined;
    // Part of the directory was scraped with protocol-relative URLs, which
    // resolve fine in the browser but break any absolute-URL assumption.
    return raw.startsWith('//') ? `https:${raw}` : raw;
}

/**
 * The three portrait sizes used across the app: small tiles in a grid,
 * cards, and the single large hero shown on a provider's own page.
 */
export type PortraitSize = 'thumb' | 'tile' | 'large';

/**
 * Target pixel width per size — also used as the Google Places `maxWidthPx`
 * / `w` query param for the server photo proxy (see src/utils/placePhoto.ts),
 * so a Google-sourced photo and a Doctoralia one are requested at comparable
 * sizes for the same slot.
 */
export const PORTRAIT_WIDTHS: Record<PortraitSize, number> = {
    thumb: 160,
    tile: 400,
    large: 800,
};

/**
 * The size ladders of Doctoralia's two image families, measured on the files
 * themselves (the suffix names mean different things in each):
 *
 *   modern  pixel-p3.s3…/(doctor|facility)/avatar/<uuid>_<v>.jpg
 *           small 320px · medium 640px · large ~850px
 *   legacy  s3…/doctoralia.com.mx/(doctor|facility)/<hex>/<hash>_<v>.jpg
 *           small 68px · medium 120px · 220_square 220px · large ≤530px
 *           (a facility's original can be as small as 200px, so large == 220_square)
 *
 * The old rule — "swap `_large` for `_small`" — was right for the modern
 * family and a 68px thumbnail for the legacy one, which is why those listings
 * looked soft next to their sharp profile page: 2,566 of the 5,400 photos.
 * Only variants confirmed to exist for both families are used (34 of 34 sampled
 * images carried every one): an <img> whose chosen candidate 404s does not fall
 * back to another, it just breaks.
 */
type Family = 'modern' | 'legacy';

const MODERN = /pixel-p3\.s3[^/]*\.amazonaws\.com\/(?:doctor|facility)\/avatar\//i;
const LEGACY = /\/doctoralia\.com\.mx\/(?:doctor|facility)\/[0-9a-f]{6}\//i;
// Every size suffix either family uses; matching it exactly (not just "contains
// _large") avoids rewriting an unrelated file that merely has it in its name.
const SIZE_SUFFIX = /_(?:small_square|medium_square|\d+_square|large|medium|small|thumb)(\.(?:jpe?g|png|webp))$/i;

/** Variant to use at 1x and at 2x-and-up, per family and slot. */
const PICK: Record<Family, Record<Exclude<PortraitSize, 'large'>, { x1: string; x2: string }>> = {
    // Card avatar (~72px CSS) and discover tile (~208px CSS).
    modern: { thumb: { x1: 'small', x2: 'small' }, tile: { x1: 'small', x2: 'medium' } },
    legacy: { thumb: { x1: 'medium', x2: '220_square' }, tile: { x1: '220_square', x2: 'large' } },
};

/** The Google photo proxy's next width up (it snaps to 160 / 400 / 800). */
const PORTRAIT_WIDTHS_2X: Record<PortraitSize, number> = { thumb: 400, tile: 800, large: 800 };
export const portraitWidth2x = (size: PortraitSize): number => PORTRAIT_WIDTHS_2X[size];

export interface PortraitImage {
    src: string;
    /** `<img srcset>`: the sharper file for high-density screens; absent when one file serves all. */
    srcSet?: string;
}

/**
 * A portrait sized for where it will be shown, and for the screen showing it.
 *
 * The 1x file is `src`; screens at 2x and above are offered the next rung of the
 * ladder through `srcSet`, so a laptop pays for 120px and a phone gets 220px
 * instead of every visitor downloading the largest file. Anything that is not a
 * Doctoralia S3 asset (or is a size we have not measured) is returned as it is.
 */
export function portraitImage(raw: string | undefined, size: PortraitSize): PortraitImage | undefined {
    const url = portraitUrl(raw);
    if (!url) return undefined;
    if (size === 'large') return { src: url };

    const family: Family | null = MODERN.test(url) ? 'modern' : LEGACY.test(url) ? 'legacy' : null;
    const m = family ? SIZE_SUFFIX.exec(url) : null;
    if (!family || !m) return { src: url };

    const base = url.slice(0, m.index);
    const ext = m[1];
    const { x1, x2 } = PICK[family][size];
    const at = (variant: string) => `${base}_${variant}${ext}`;
    return x1 === x2 ? { src: at(x1) } : { src: at(x1), srcSet: `${at(x2)} 2x` };
}

/** Just the URL, for callers with no use for a `srcset` (a 34px avatar, say). */
export function portraitUrlSized(raw: string | undefined, size: PortraitSize): string | undefined {
    return portraitImage(raw, size)?.src;
}

/**
 * The palette a provider's monogram is drawn from.
 *
 * Six curated tints, not the full colour wheel. The avatar is the most
 * repeated element in the product — 4,000+ of them scroll past on a
 * single search — so an unbounded hue lets the content out-colour the
 * brand. These six sit in a narrow band and are held at low saturation
 * by --mono-s1/--mono-s2, so a row of them reads as tinted paper rather
 * than as confetti.
 *
 * The gradient's second stop is this hue + 40deg (see .ms-mono), so the
 * set is chosen to stay coherent under that shift.
 */
const MONO_HUES = [158, 205, 252, 32, 282, 120];

/**
 * A stable tint per provider, for the gradient shown in place of a portrait.
 *
 * Derived from the id so a given clinic keeps its colour across reloads and
 * across the browse rows it appears in — a card that changes colour when you
 * scroll past it twice reads as a different clinic.
 */
export function hueOf(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 4096;
    return MONO_HUES[h % MONO_HUES.length];
}
