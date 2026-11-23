/**
 * MedSociety icon set — hand-drawn, single-stroke line icons.
 *
 * These exist so the product never renders a system emoji: emoji render
 * differently per OS, carry no brand, and (in the case of flags) imply a
 * political symbol where we only mean "which side of the border".
 *
 * House rules for anything added here:
 *   • 24×24 viewBox, geometry inset to a 20px optical box
 *   • stroke = currentColor, strokeWidth 1.6, round caps + joins
 *   • no fills except where a shape reads as solid (star, pin dot)
 */
import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'size'> {
    size?: number;
    /** Stroke weight override. Bump to 2 for icons under ~16px. */
    weight?: number;
}

function Svg({ size = 20, weight = 1.6, children, ...rest }: IconProps & { children: React.ReactNode }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={weight}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            {...rest}
        >
            {children}
        </svg>
    );
}

/**
 * Secondary detail layer. Specialty icons are drawn in two weights of the same
 * colour: the silhouette at full strength, and the finer anatomy / motion /
 * sparkle marks at reduced opacity. It is what makes them read as detailed
 * without ever adding a second hue, so they stay on the green accent.
 */
function Soft({ children }: { children: React.ReactNode }) {
    return <g opacity={0.5}>{children}</g>;
}

/* ══ Ratings ══════════════════════════════════════════════════ */

/** Rating star. `filled` draws it solid — used for earned stars. */
export function IconStar({ filled = false, ...p }: IconProps & { filled?: boolean }) {
    return (
        <Svg {...p}>
            <path
                d="M12 3.6l2.6 5.3 5.85.85-4.23 4.12 1 5.83L12 16.95l-5.22 2.75 1-5.83L3.55 9.75 9.4 8.9z"
                fill={filled ? 'currentColor' : 'none'}
            />
        </Svg>
    );
}

/* ══ Border / country marks ═══════════════════════════════════
   Deliberately not flags. Each is a shield (a "jurisdiction") with a
   distinguishing glyph: a star for the US side, an agave for Mexico.
   ═══════════════════════════════════════════════════════════════ */

/** United States side of the border. Shield + star. */
export function IconUS(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M12 2.9l7 2.6v6.1c0 4.2-2.85 7.8-7 9.5-4.15-1.7-7-5.3-7-9.5V5.5z" />
            <path d="M12 8.1l1.28 2.6 2.87.42-2.08 2.02.49 2.86L12 14.65l-2.56 1.35.49-2.86-2.08-2.02 2.87-.42z" fill="currentColor" stroke="none" />
        </Svg>
    );
}

/** Mexican side of the border. Shield + agave. */
export function IconMX(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M12 2.9l7 2.6v6.1c0 4.2-2.85 7.8-7 9.5-4.15-1.7-7-5.3-7-9.5V5.5z" />
            <path d="M12 16.4V9.2" />
            <path d="M12 12.4c-1.5-.5-2.5-1.8-2.6-3.5 1.5.2 2.4 1.1 2.6 2.4" />
            <path d="M12 12.4c1.5-.5 2.5-1.8 2.6-3.5-1.5.2-2.4 1.1-2.6 2.4" />
        </Svg>
    );
}

/** Both sides of the border — two territories meeting at a line. */
export function IconBorder(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="8.6" cy="12" r="6.1" />
            <circle cx="15.4" cy="12" r="6.1" />
            <path d="M12 4.4v15.2" strokeDasharray="2.4 2.4" />
        </Svg>
    );
}

/* ══ Interface ════════════════════════════════════════════════ */

export function IconSearch(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="10.8" cy="10.8" r="6.4" />
            <path d="M15.5 15.5L20 20" />
        </Svg>
    );
}

export function IconClose(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M6 6l12 12M18 6L6 18" />
        </Svg>
    );
}

export function IconMenu(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M4 7h16M4 12h16M4 17h16" />
        </Svg>
    );
}

export function IconChevronRight(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M9.5 5.5l6.5 6.5-6.5 6.5" />
        </Svg>
    );
}

export function IconChevronLeft(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
        </Svg>
    );
}

export function IconChevronDown(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M5.5 9.5L12 16l6.5-6.5" />
        </Svg>
    );
}

export function IconArrowRight(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M4.5 12h15" />
            <path d="M13.5 6l6 6-6 6" />
        </Svg>
    );
}

export function IconCheck(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M4.5 12.6l4.8 4.8L19.5 7.2" />
        </Svg>
    );
}

/** Verified — a check enclosed in a seal. */
export function IconVerified(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M12 2.9l2.35 1.72 2.9-.06.87 2.77 2.35 1.7-.94 2.75.94 2.75-2.35 1.7-.87 2.77-2.9-.06L12 21.1l-2.35-1.72-2.9.06-.87-2.77-2.35-1.7.94-2.75-.94-2.75 2.35-1.7.87-2.77 2.9.06z" />
            <path d="M8.7 12.1l2.2 2.2 4.4-4.5" />
        </Svg>
    );
}

/** Promoted — a signal boost, not a lightning bolt cliché. */
export function IconPromoted(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M12 13.6a2.1 2.1 0 100-4.2 2.1 2.1 0 000 4.2z" fill="currentColor" stroke="none" />
            <path d="M7.9 15.6a5.1 5.1 0 010-7.2" />
            <path d="M16.1 8.4a5.1 5.1 0 010 7.2" />
            <path d="M5 18.5a9 9 0 010-13" />
            <path d="M19 5.5a9 9 0 010 13" />
        </Svg>
    );
}

export function IconMapPin(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M19 10.3c0 5.1-7 11.2-7 11.2s-7-6.1-7-11.2a7 7 0 1114 0z" />
            <circle cx="12" cy="10.1" r="2.5" />
        </Svg>
    );
}

/** Three sliders — the filter panel toggle. */
export function IconSliders(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h7M15 17h5" />
            <circle cx="15" cy="7" r="2" />
            <circle cx="9" cy="12" r="2" />
            <circle cx="13" cy="17" r="2" />
        </Svg>
    );
}

export function IconList(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M9 6.5h11M9 12h11M9 17.5h11" />
            <path d="M4.4 6.5h.01M4.4 12h.01M4.4 17.5h.01" strokeWidth={2.4} />
        </Svg>
    );
}

export function IconPhone(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M8.1 3.6l2.1 4-1.9 2a11.5 11.5 0 006.1 6.1l2-1.9 4 2.1v3a1.6 1.6 0 01-1.8 1.6C10.9 19.6 4.4 13.1 3.5 5.4A1.6 1.6 0 015.1 3.6z" />
        </Svg>
    );
}

export function IconGlobe(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="12" cy="12" r="8.8" />
            <path d="M3.2 12h17.6" />
            <path d="M12 3.2a13.5 13.5 0 010 17.6 13.5 13.5 0 010-17.6z" />
        </Svg>
    );
}

/** Language — two scripts side by side. */
export function IconLanguage(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M3.4 6.2h8.4" />
            <path d="M7.6 4.1v2.1" />
            <path d="M10 6.2c0 3.6-2.4 6.6-5.5 7.6" />
            <path d="M5.6 9.4c.9 2.2 2.7 3.8 5 4.4" />
            <path d="M13 20.4l3.9-9.6 3.9 9.6" />
            <path d="M14.4 17h5" />
        </Svg>
    );
}

export function IconSun(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.6v2.1M12 19.3v2.1M4.35 4.35l1.5 1.5M18.15 18.15l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.35 19.65l1.5-1.5M18.15 5.85l1.5-1.5" />
        </Svg>
    );
}

export function IconMoon(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M20.3 14.2A8.6 8.6 0 019.8 3.7a8.8 8.8 0 1010.5 10.5z" />
        </Svg>
    );
}

/** Locate me — a navigation reticle. */
export function IconLocate(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="12" cy="12" r="3.1" />
            <circle cx="12" cy="12" r="7.4" />
            <path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4" />
        </Svg>
    );
}

/** Review count — a quote in a bubble. */
export function IconReviews(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M20.4 13.6a2.9 2.9 0 01-2.9 2.9H8.9L4.6 20.1V6.3a2.9 2.9 0 012.9-2.9h10a2.9 2.9 0 012.9 2.9z" />
            <path d="M9 9.4v1.2M12 9.4v1.2M15 9.4v1.2" strokeWidth={2.2} />
        </Svg>
    );
}

/** Smart (AI) search: one large and one small four-point spark. */
export function IconSparkle(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M10 3.5l1.7 4.6a2 2 0 001.2 1.2l4.6 1.7-4.6 1.7a2 2 0 00-1.2 1.2L10 18.5l-1.7-4.6a2 2 0 00-1.2-1.2L2.5 11l4.6-1.7a2 2 0 001.2-1.2z" />
            <path d="M18.5 15v5M16 17.5h5" />
        </Svg>
    );
}

/** Profile views. */
export function IconViews(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M2.4 12S5.9 5.6 12 5.6 21.6 12 21.6 12 18.1 18.4 12 18.4 2.4 12 2.4 12z" />
            <circle cx="12" cy="12" r="2.9" />
        </Svg>
    );
}

export function IconChart(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M4 20h16" />
            <path d="M7 20v-6.2M12 20V6.4M17 20v-9.4" />
        </Svg>
    );
}

export function IconClipboard(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M9.4 4.6H7.2a1.8 1.8 0 00-1.8 1.8v12.8a1.8 1.8 0 001.8 1.8h9.6a1.8 1.8 0 001.8-1.8V6.4a1.8 1.8 0 00-1.8-1.8h-2.2" />
            <rect x="9.4" y="2.6" width="5.2" height="4" rx="1.3" />
            <path d="M8.9 12h6.2M8.9 15.6h4" />
        </Svg>
    );
}

/** A pin dropped on a map plane — used for "appear on the map". */
export function IconMapPlane(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M2.8 6.6l6.1-2.2 6.2 2.2 6.1-2.2v12.9l-6.1 2.2-6.2-2.2-6.1 2.2z" />
            <path d="M8.9 4.4v14.9M15.1 6.6v14.9" />
        </Svg>
    );
}

export function IconShield(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M12 2.9l7.4 2.7v6.2c0 4.4-3 8.2-7.4 10-4.4-1.8-7.4-5.6-7.4-10V5.6z" />
        </Svg>
    );
}

/** Marks a feature a plan has not bought yet. */
export function IconLock(p: IconProps) {
    return (
        <Svg {...p}>
            <rect x="4.4" y="10.4" width="15.2" height="10.4" rx="2.2" />
            <path d="M8.2 10.4V7.6a3.8 3.8 0 017.6 0v2.8" />
        </Svg>
    );
}

export function IconClinic(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M4.2 20.2V8.4l7.8-4.6 7.8 4.6v11.8z" />
            <path d="M12 10.2v5.4M9.3 12.9h5.4" />
        </Svg>
    );
}

/** A bed, for hotels and places to stay. */
export function IconBed(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M3.4 18.6V6.4M3.4 14.2h17.2v4.4M20.6 14.2v-2.4a2.6 2.6 0 0 0-2.6-2.6h-7v5" />
            <circle cx="7.2" cy="11.2" r="1.8" />
        </Svg>
    );
}

/* ══ Specialties ══════════════════════════════════════════════ */

/** Primary & family care: a parent and child under a shared heart, the whole family in one doctor's care. */
export function IconFamilyCare(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M12 9.2c-2-1.2-2.9-2.3-2.9-3.4a1.6 1.6 0 012.9-.9 1.6 1.6 0 012.9.9c0 1.1-.9 2.2-2.9 3.4z" />
            <circle cx="8" cy="13.2" r="2.1" />
            <path d="M3.6 21a4.4 4.4 0 018.8 0" />
            <circle cx="16.8" cy="15.4" r="1.7" />
            <path d="M13.5 21a3.3 3.3 0 016.6 0" />
            <Soft>
                <path d="M6.4 5.4a4.2 4.2 0 00-.9 2.8M17.6 5.4a4.2 4.2 0 01.9 2.8" />
            </Soft>
        </Svg>
    );
}

/** Dentist and orthodontist share this tile: a molar, with the enamel highlight and the crown line. */
export function IconTooth(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M7.4 3.6C5.1 3.6 3.6 5.5 3.6 8c0 2.1.7 3.4 1.3 5.4.5 1.7.5 3.5.9 5.3.2 1.1.8 1.7 1.5 1.7.9 0 1.3-.8 1.6-2.2l.7-3.4c.1-.7.4-1.1 1.1-1.1h1.4c.7 0 1 .4 1.1 1.1l.7 3.4c.3 1.4.7 2.2 1.6 2.2.7 0 1.3-.6 1.5-1.7.4-1.8.4-3.6.9-5.3.6-2 1.3-3.3 1.3-5.4 0-2.5-1.5-4.4-3.8-4.4-1.7 0-2.4.9-4.4.9s-2.7-.9-4.4-.9z" />
            <Soft>
                <path d="M6.5 8.4c0-1.3.7-2.3 1.9-2.5" />
                <path d="M7.2 12.4c1.5.7 3 1 4.8 1s3.3-.3 4.8-1" />
                <path d="M17.2 6.4c.4.4.6.9.6 1.6" />
            </Soft>
        </Svg>
    );
}

/** Orthodontist: both arches, the archwire, and a bracket on each tooth. */
export function IconBraces(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M3.4 8.4a11.6 11.6 0 0117.2 0" />
            <path d="M3.4 15.6a11.6 11.6 0 0017.2 0" />
            <path d="M3.9 12h16.2" />
            <rect x="7" y="10.8" width="2.4" height="2.4" rx=".5" />
            <rect x="10.8" y="10.8" width="2.4" height="2.4" rx=".5" />
            <rect x="14.6" y="10.8" width="2.4" height="2.4" rx=".5" />
            <Soft>
                <path d="M10.1 7.4v2.8M13.9 7.4v2.8M10.1 13.8v2.8M13.9 13.8v2.8" />
                <path d="M6.2 7.2v2.4M17.8 7.2v2.4M6.2 14.4v2.4M17.8 14.4v2.4" />
            </Soft>
        </Svg>
    );
}

/** Plastic surgery: a syringe with graduations, and a sparkle for the result. */
export function IconSyringe(p: IconProps) {
    return (
        <Svg {...p}>
            <g transform="rotate(45 12 12)">
                <path d="M9.8 2.8h4.4M12 2.8v3.4M8.4 6.2h7.2" />
                <path d="M9.6 6.2v10.2h4.8V6.2" />
                <path d="M11 16.4v1.4h2v-1.4M12 17.8v3.8" />
                <Soft>
                    <path d="M9.6 9h1.8M9.6 11.4h1.8M9.6 13.8h1.8" />
                </Soft>
            </g>
            <Soft>
                <path d="M6 3.4l.9 1.9 1.9.9-1.9.9L6 9l-.9-1.9-1.9-.9 1.9-.9z" />
            </Soft>
        </Svg>
    );
}

/** Aesthetician: a radiant sparkle with a smaller one and a few drops of glow. */
export function IconAesthetics(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M12 3.4l1.65 4.95L18.6 10l-4.95 1.65L12 16.6l-1.65-4.95L5.4 10l4.95-1.65z" />
            <path d="M18.2 16.2l.75 2.05 2.05.75-2.05.75-.75 2.05-.75-2.05-2.05-.75 2.05-.75z" />
            <Soft>
                <path d="M12 6.8v1.2M8.4 10h1.2M14.4 10h1.2M12 12v1.2" />
                <path d="M5.6 17.2l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
                <path d="M19.4 4.6h.01" strokeWidth={2.4} />
            </Soft>
        </Svg>
    );
}

/** OB/GYN and women's health: the venus mark with a heart at its centre. */
export function IconObgyn(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="12" cy="8.2" r="4.8" />
            <path d="M12 13v8M8.8 17.4h6.4" />
            <path d="M12 10.5c-1.6-1-2.2-1.8-2.2-2.7a1.2 1.2 0 012.2-.6 1.2 1.2 0 012.2.6c0 .9-.6 1.7-2.2 2.7z" />
            <Soft>
                <path d="M19.2 3.2v2.6M17.9 4.5h2.6" />
                <path d="M4.6 14.6h.01" strokeWidth={2.4} />
            </Soft>
        </Svg>
    );
}

/** Physical therapy: a knee joint (femur, kneecap, tibia) with the arrow of the movement being restored. */
export function IconPhysio(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M10.2 2.4v5.6c0 .8-1.6 1.5-1.6 3a3.4 3.4 0 006.8 0c0-1.5-1.6-2.2-1.6-3V2.4" />
            <path d="M8.2 15.8h7.6v1.2c0 .8-1.8 1.2-1.8 2.4v2.4M8.2 15.8v1.2c0 .8 1.8 1.2 1.8 2.4v2.4" />
            <circle cx="18" cy="11.2" r="1.9" />
            <Soft>
                <path d="M5.4 5.2a8.4 8.4 0 00-.2 9" />
                <path d="M3.6 12.6l1.6 1.8 1.9-1.6" />
            </Soft>
        </Svg>
    );
}

/** Massage: a balanced stack of spa stones with a sprig of leaf, the symbol of calm and bodywork. */
export function IconMassage(p: IconProps) {
    return (
        <Svg {...p}>
            <ellipse cx="12" cy="18.2" rx="6.6" ry="2.7" />
            <ellipse cx="12" cy="13.5" rx="4.8" ry="2.2" />
            <ellipse cx="12" cy="9.5" rx="3.1" ry="1.8" />
            <path d="M12 7.7c0-2.1.9-3.5 2.9-4.1.1 2.1-.9 3.7-2.9 4.1z" />
            <Soft>
                <path d="M8.2 17.7c.8.6 1.9.8 3 .7" />
                <path d="M9.6 13c.6.3 1.3.4 2 .3" />
                <path d="M12 7.7V6" />
                <path d="M6.6 22h10.8" />
            </Soft>
        </Svg>
    );
}

/** Vision & optometry: spectacles with a glint on each lens. */
export function IconOptometry(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="6.6" cy="14" r="3.8" />
            <circle cx="17.4" cy="14" r="3.8" />
            <path d="M10.4 13.2c1-.7 2.2-.7 3.2 0" />
            <path d="M2.9 13l1.6-6.4M21.1 13l-1.6-6.4" />
            <Soft>
                <path d="M4.6 13.4a2.2 2.2 0 011.5-1.6" />
                <path d="M15.4 13.4a2.2 2.2 0 011.5-1.6" />
                <path d="M12 3.2v2.6M10.7 4.5h2.6" />
            </Soft>
        </Svg>
    );
}

/** Pediatrics: a teddy bear, the one face every child's doctor shares, with a plaster on its forehead. */
export function IconPediatrics(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="12" cy="13.4" r="6.6" />
            <path d="M6.02 10.6A2.8 2.8 0 1 1 9.2 7.42M14.8 7.42A2.8 2.8 0 1 1 17.98 10.6" />
            <path d="M9.5 12.2h.01M14.5 12.2h.01" strokeWidth={2.4} />
            <ellipse cx="12" cy="16.2" rx="2.7" ry="2" />
            <path d="M10.9 15.2h2.2c0 .6-.5 1-1.1 1s-1.1-.4-1.1-1z" />
            <Soft>
                <path d="M12 16.2v.9M11 17.7c.4.3.7.4 1 .4s.6-.1 1-.4" />
                <path d="M15.4 8.8l2.1 2.1" strokeWidth={2.6} />
                <path d="M7.4 7.6a1 1 0 011.2-.6M16.6 7.6a1 1 0 00-1.2-.6" />
            </Soft>
        </Svg>
    );
}

/** Neurology: a brain, two hemispheres split by a centre fold. */
export function IconNeurology(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M12 5.2a3.2 3.2 0 00-5.6 1.1 3 3 0 00-2.1 4.4 3 3 0 00.9 4.9 3.2 3.2 0 005.2 2.9L12 19z" />
            <path d="M12 5.2a3.2 3.2 0 015.6 1.1 3 3 0 012.1 4.4 3 3 0 01-.9 4.9 3.2 3.2 0 01-5.2 2.9L12 19z" />
            <path d="M12 5.2V19M8.4 9.6c1 .2 1.7 1 1.7 2M15.6 9.6c-1 .2-1.7 1-1.7 2" />
            <Soft>
                <path d="M6.6 14c1.2-.1 2.2.5 2.6 1.5M17.4 14c-1.2-.1-2.2.5-2.6 1.5" />
                <path d="M9 6.8c.7.5 1.5.6 2.2.4M15 6.8c-.7.5-1.5.6-2.2.4" />
                <path d="M12 2.4v1.6M5 3.6l1 1.2M19 3.6l-1 1.2" />
            </Soft>
        </Svg>
    );
}

/** Ear, nose & throat: an ear, with sound arriving. */
export function IconOtolaryngology(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M6.6 9.4a5.4 5.4 0 0110.8 0c0 2.4-1.4 3.4-2.4 4.4-.9.9-1 1.7-1 2.7a2.8 2.8 0 01-5.3 1.3" />
            <path d="M9.4 9.6a2.6 2.6 0 015.2 0c0 1.2-.9 1.6-1.6 2.1" />
            <Soft>
                <path d="M4.2 7.6a4 4 0 000 3.8" />
                <path d="M2.4 6a6.6 6.6 0 000 7" />
                <path d="M16.4 19.2h.01" strokeWidth={2.4} />
            </Soft>
        </Svg>
    );
}

/** Gastroenterology: a stomach, with the oesophagus entering at the top, the fundus dome, the curve down to the pylorus and the duodenum leaving. */
export function IconGastroenterology(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M10 2.4v3C8 4.4 4.6 5.4 3.9 9.8c-.7 4.4 1.7 9.6 7.5 10.4 5 .7 8.8-2.4 8.4-6.2-.2-1.8-1.2-3-3-3.4-2.4-.5-4-1.9-4-4.2V2.4" />
            <path d="M18.8 12.6c1.3-.2 2.5-1.2 2.7-2.7" />
            <Soft>
                <path d="M7 11.8c1.7.9 4 1 5.8.2" />
                <path d="M7.6 15.4c1.7.8 3.6.7 5.2 0" />
                <path d="M6.6 8.4c.3-.9.9-1.6 1.7-2" />
            </Soft>
        </Svg>
    );
}

/** Orthopedics: a long bone. */
/** Orthopedics & trauma: a long bone, bandaged where it would break. */
export function IconOrthopedics(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M15.6 5.6a2.2 2.2 0 113.1 3.1 2.2 2.2 0 11-3.1 3.1l-3.8 3.8a2.2 2.2 0 11-3.1 3.1 2.2 2.2 0 11-3.1-3.1 2.2 2.2 0 113.1-3.1l3.8-3.8a2.2 2.2 0 113.1-3.1z" />
            <Soft>
                <path d="M10.6 10.2l3.2 3.2M9.7 11.1l3.2 3.2" />
                <path d="M4.2 4.4v2.4M3 5.6h2.4" />
                <path d="M19.8 17.6v2.4M18.6 18.8H21" />
            </Soft>
        </Svg>
    );
}

/** Cardiology: a heart with its pulse line and a highlight on the curve. */
export function IconCardiology(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M20.2 8.6c0 4.9-8.2 10.6-8.2 10.6S3.8 13.5 3.8 8.6a4.4 4.4 0 018.2-2.3 4.4 4.4 0 018.2 2.3z" />
            <path d="M3.9 11.6h3.5l1.5-2.6 2 5 1.6-3.1 1.2 1.7h4.4" />
            <Soft>
                <path d="M6.4 7.8a2.3 2.3 0 011.7-1.6" />
                <path d="M12 6.3V3.4M10 3.4h4" />
            </Soft>
        </Svg>
    );
}

/** Urgent care: a stopwatch, because the point is how fast, holding a medical cross. */
export function IconUrgentCare(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="12" cy="13.2" r="7.4" />
            <path d="M12 5.8V3.6M10 3.6h4" />
            <path d="M17.2 8l1.6-1.6" />
            <path d="M10.7 9.5h2.6v2.4h2.4v2.6h-2.4v2.4h-2.6v-2.4H8.3v-2.6h2.4z" />
            <Soft>
                <path d="M12 7.2v.9M12 18.3v.9M5.8 13.2h.9M17.3 13.2h.9" />
            </Soft>
        </Svg>
    );
}

/** Mental health: a head in profile with a heart held inside it. */
export function IconMentalHealth(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M7.4 21v-3.4C5.5 16.3 4.6 14.2 4.6 11A7 7 0 0 1 18.4 9.6L20.4 13.4 18.6 14.2 18.7 15.4 17.6 16.4 17 18.2 14.6 18.4V21" />
            <path d="M11.4 14.2c-2.3-1.4-3.2-2.6-3.2-3.9a1.8 1.8 0 013.2-1.1 1.8 1.8 0 013.2 1.1c0 1.3-.9 2.5-3.2 3.9z" />
            <Soft>
                <path d="M7.2 8.2a5 5 0 013-2.8" />
            </Soft>
        </Svg>
    );
}

/** Pharmacy: a capsule and a scored tablet. */
export function IconPharmacy(p: IconProps) {
    return (
        <Svg {...p}>
            <g transform="rotate(-45 11 13)">
                <rect x="3.6" y="9.6" width="14.8" height="6.8" rx="3.4" />
                <path d="M11 9.6v6.8" />
                <Soft>
                    <path d="M6.2 11.6h2.2M13.6 14.4h2" />
                </Soft>
            </g>
            <circle cx="18.4" cy="18.2" r="2.8" />
            <Soft>
                <path d="M16.8 19.8l3.2-3.2" />
                <path d="M5.6 3.4v2.6M4.3 4.7h2.6" />
            </Soft>
        </Svg>
    );
}

/** Telehealth: a screen showing a pulse, with a camera dot and a stand. */
export function IconTelehealth(p: IconProps) {
    return (
        <Svg {...p}>
            <rect x="2.9" y="4.6" width="18.2" height="12.4" rx="2.2" />
            <path d="M8.4 20.4h7.2M12 17v3.4" />
            <path d="M6.4 11.6h2.4l1.2-2.2 1.8 4.4 1.4-2.6 1 1.6h2.4" />
            <Soft>
                <path d="M12 6.8h.01" strokeWidth={2.2} />
                <path d="M5 6.8h2M17 6.8h2" />
            </Soft>
        </Svg>
    );
}

/* ══ Specialty registry ═══════════════════════════════════════ */

type IconComponent = (p: IconProps) => React.ReactElement;

const SPECIALTY_ICONS: Record<string, IconComponent> = {
    dentist: IconTooth,
    orthodontist: IconBraces,
    plastic_surgery: IconSyringe,
    aesthetician: IconAesthetics,
    obgyn: IconObgyn,
    physical_therapy: IconPhysio,
    massage: IconMassage,
    optometry: IconOptometry,
    general: IconFamilyCare,
    pediatrics: IconPediatrics,
    cardiology: IconCardiology,
    urgent_care: IconUrgentCare,
    mental_health: IconMentalHealth,
    pharmacy: IconPharmacy,
    telehealth: IconTelehealth,
    neurology: IconNeurology,
    otolaryngology: IconOtolaryngology,
    orthopedics: IconOrthopedics,
    gastroenterology: IconGastroenterology,
};

/** Renders the icon for a specialty key, falling back to the clinic mark. */
export function SpecialtyIcon({ specialty, ...p }: IconProps & { specialty: string }) {
    const Cmp = SPECIALTY_ICONS[specialty] ?? IconClinic;
    return <Cmp {...p} />;
}

/** Renders the shield mark for whichever side of the border a clinic is on. */
export function CountryIcon({ country, ...p }: IconProps & { country: 'US' | 'MX' }) {
    return country === 'MX' ? <IconMX {...p} /> : <IconUS {...p} />;
}
