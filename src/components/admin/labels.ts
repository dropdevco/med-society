import { FORMS, STATES } from '../borderhealth/forms';
import type { BhSegment } from '../borderhealth/types';

export const SEGMENTS: BhSegment[] = ['employer', 'employee', 'provider'];
export const SEGMENT_LABEL: Record<string, string> = {
    employer: 'Employer',
    employee: 'Employee / patient',
    provider: 'Provider / clinic',
};
export const SLUG_LABEL: Record<string, string> = {
    research: '/research (MLCIC + NSF I-Corps)',
    borderhealth: '/borderhealth (MedSociety)',
};
export const REGION_LABEL: Record<string, string> = {
    'elpaso-juarez': 'El Paso – Juárez',
    'sandiego-tijuana': 'San Diego – Tijuana',
};

/** state_key (MX-CHH, US-TX, other_country) -> "Chihuahua, Mexico". */
export const STATE_LABEL: Record<string, string> = Object.fromEntries(
    STATES.map((s) => [s.v, s.v.startsWith('MX-') ? `${s.en}, Mexico` : s.v.startsWith('US-') ? `${s.en}, US` : s.en]),
);

export function regionName(r: string): string {
    return REGION_LABEL[r] ?? r;
}

export function pretty(s: string | null | undefined): string {
    if (!s) return '(none)';
    return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface QMeta { id: string; label: string; opts: Record<string, string>; kind: string; other?: boolean }

/** question id -> English label and option labels, per segment, in form order. */
export const QUESTIONS: Record<string, QMeta[]> = Object.fromEntries(
    SEGMENTS.map((seg) => {
        const all = FORMS[seg].flatMap((s) => s.qs);
        const byId = new Map(all.map((q) => [q.id, q]));
        const metas: QMeta[] = [];
        for (const q of all) {
            // A "top" question picks from the options of the multi it follows.
            const src = q.type === 'top' && q.from ? byId.get(q.from) ?? q : q;
            const opts = Object.fromEntries((src.opts ?? []).map((o) => [o.v, o.en]));
            metas.push({ id: q.id, label: q.en, opts, kind: q.type });
            if (q.other) metas.push({ id: `${q.id}_other`, label: `${q.en} (typed "other")`, opts: {}, kind: 'text', other: true });
        }
        return [seg, metas];
    }),
);

export function answerLabel(seg: string, qid: string, v: string): string {
    const m = QUESTIONS[seg]?.find((q) => q.id === qid);
    return m?.opts[v] ?? v;
}

export function questionLabel(seg: string, qid: string): string {
    return QUESTIONS[seg]?.find((q) => q.id === qid)?.label ?? pretty(qid);
}

export function flattenAnswer(seg: string, qid: string, val: unknown): string {
    if (Array.isArray(val)) return val.map((v) => answerLabel(seg, qid, String(v))).join(', ');
    if (val && typeof val === 'object') return JSON.stringify(val);
    return answerLabel(seg, qid, String(val ?? ''));
}
