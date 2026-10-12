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

/* ══ Specialties ══════════════════════════════════════════════ */

export function IconTooth(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M7.4 3.6C5.1 3.6 3.6 5.5 3.6 8c0 2.1.7 3.4 1.3 5.4.5 1.7.5 3.5.9 5.3.2 1.1.8 1.7 1.5 1.7.9 0 1.3-.8 1.6-2.2l.7-3.4c.1-.7.4-1.1 1.1-1.1h1.4c.7 0 1 .4 1.1 1.1l.7 3.4c.3 1.4.7 2.2 1.6 2.2.7 0 1.3-.6 1.5-1.7.4-1.8.4-3.6.9-5.3.6-2 1.3-3.3 1.3-5.4 0-2.5-1.5-4.4-3.8-4.4-1.7 0-2.4.9-4.4.9s-2.7-.9-4.4-.9z" />
        </Svg>
    );
}

export function IconBraces(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M3.4 8.4a11.6 11.6 0 0117.2 0" />
            <path d="M3.4 15.6a11.6 11.6 0 0017.2 0" />
            <path d="M3.9 12h16.2" />
            <path d="M8.2 9.9v4.2M12 9.9v4.2M15.8 9.9v4.2" />
        </Svg>
    );
}

export function IconSyringe(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M20.4 3.6l-2.6 2.6" />
            <path d="M18.9 8.4l-3.3-3.3" />
            <path d="M16.6 6.1L8.4 14.3l-.6 3.9 3.9-.6 8.2-8.2z" />
            <path d="M7.8 18.2l-3.3 3.3" />
            <path d="M12.6 9.9l1.6 1.6M10.4 12.1l1.6 1.6" />
        </Svg>
    );
}

export function IconAesthetics(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M12 3.4l1.65 4.95L18.6 10l-4.95 1.65L12 16.6l-1.65-4.95L5.4 10l4.95-1.65z" />
            <path d="M18.2 16.2l.75 2.05 2.05.75-2.05.75-.75 2.05-.75-2.05-2.05-.75 2.05-.75z" />
        </Svg>
    );
}

export function IconObgyn(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="12" cy="7.6" r="4.2" />
            <path d="M12 11.8v8.6" />
            <path d="M8.8 17.4h6.4" />
        </Svg>
    );
}

export function IconPhysio(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="14.6" cy="4.9" r="1.9" />
            <path d="M13.4 20.6l1.3-5-2.9-2.6.9-4.9" />
            <path d="M12.7 8.1L9 9.9l-.9 3.3" />
            <path d="M12.7 8.1l4 1.9 1.9 3.1" />
            <path d="M14.7 15.6l3.4 4" />
        </Svg>
    );
}

export function IconMassage(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M3.6 15.4c0-2.4 1.9-4.3 4.3-4.3h8.2c2.4 0 4.3 1.9 4.3 4.3v.9H3.6z" />
            <path d="M3.6 18.9h16.8" />
            <circle cx="7.4" cy="7.6" r="2.6" />
        </Svg>
    );
}

export function IconOptometry(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="6.6" cy="14.2" r="3.6" />
            <circle cx="17.4" cy="14.2" r="3.6" />
            <path d="M10.2 13.6h3.6" />
            <path d="M3 13.4l2.2-6.6M21 13.4l-2.2-6.6" />
        </Svg>
    );
}

export function IconPediatrics(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="12" cy="8.2" r="4.6" />
            <path d="M10.3 7.6h.01M13.7 7.6h.01" strokeWidth={2.4} />
            <path d="M10.4 10.2a2.4 2.4 0 003.2 0" />
            <path d="M6.4 20.6a5.6 5.6 0 0111.2 0" />
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
        </Svg>
    );
}

/** Ear, nose & throat: an ear. */
export function IconOtolaryngology(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M6.6 9.4a5.4 5.4 0 0110.8 0c0 2.4-1.4 3.4-2.4 4.4-.9.9-1 1.7-1 2.7a2.8 2.8 0 01-5.3 1.3" />
            <path d="M9.4 9.6a2.6 2.6 0 015.2 0c0 1.2-.9 1.6-1.6 2.1" />
        </Svg>
    );
}

/** Gastroenterology: a stomach, oesophagus entering at the top and the duodenum leaving at the side. */
export function IconGastroenterology(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M8.5 2.8V6.2C8.5 7.6 5.6 7.4 4.6 10.8C3.4 15 5.8 19.6 10.6 20C14.4 20.3 17.2 18.6 17.8 15.6C18.1 14 17.6 13 17 12.2C14.4 11.2 11.5 10.6 11.5 7.4V2.8" />
            <path d="M17.7 16.2C19.5 16 20.7 14.8 20.7 13.2" />
        </Svg>
    );
}

/** Orthopedics: a long bone. */
export function IconOrthopedics(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M15.6 5.6a2.2 2.2 0 113.1 3.1 2.2 2.2 0 11-3.1 3.1l-3.8 3.8a2.2 2.2 0 11-3.1 3.1 2.2 2.2 0 11-3.1-3.1 2.2 2.2 0 113.1-3.1l3.8-3.8a2.2 2.2 0 113.1-3.1z" />
        </Svg>
    );
}

export function IconCardiology(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M20.2 8.6c0 4.9-8.2 10.6-8.2 10.6S3.8 13.5 3.8 8.6a4.4 4.4 0 018.2-2.3 4.4 4.4 0 018.2 2.3z" />
            <path d="M3.9 11.6h3.5l1.5-2.6 2 5 1.6-3.1 1.2 1.7h4.4" />
        </Svg>
    );
}

export function IconUrgentCare(p: IconProps) {
    return (
        <Svg {...p}>
            <circle cx="12" cy="12" r="8.8" />
            <path d="M12 7.4v9.2M7.4 12h9.2" />
        </Svg>
    );
}

export function IconMentalHealth(p: IconProps) {
    return (
        <Svg {...p}>
            <path d="M15.4 20.4v-2.9c2.6-1 4.4-3.5 4.4-6.4a7.4 7.4 0 10-14.8 0c0 1.5.4 2.6 1.1 3.6l-1 1.9h2.1v2.4a1.4 1.4 0 001.4 1.4z" />
            <path d="M12.4 13.8c-1.6-.3-2.7-1.5-2.7-3a2.3 2.3 0 014.6 0c0 .9-.5 1.5-1.2 1.9" />
        </Svg>
    );
}

export function IconPharmacy(p: IconProps) {
    return (
        <Svg {...p}>
            <rect x="2.8" y="8.4" width="18.4" height="8.4" rx="4.2" />
            <path d="M12 8.4v8.4" />
            <path d="M5.4 6.2h13.2" />
        </Svg>
    );
}

export function IconTelehealth(p: IconProps) {
    return (
        <Svg {...p}>
            <rect x="2.9" y="4.6" width="18.2" height="12.4" rx="2.2" />
            <path d="M8.4 20.4h7.2" />
            <path d="M6.4 11.2h2.4l1.2-2.2 1.8 4.4 1.4-2.6 1 1.6h2.4" />
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
    general: IconClinic,
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
