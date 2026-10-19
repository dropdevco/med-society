/**
 * Pure survey rules, ported from the static page: conditional visibility,
 * "which matters most" options, validation, and the answers JSON that goes
 * into bh_responses.answers. No React, no DOM, so it can be checked in node.
 */
import { FORMS, FORM_VERSION, o } from './forms';
import type { Cond, Opt, Question, Screen } from './forms';
import type { Answers } from './storage';
import type { BhLang, BhSegment } from './types';

export function filled(v: unknown): boolean {
    return Array.isArray(v) ? v.length > 0 : (v != null && String(v).trim() !== '');
}

export function str(a: Answers, id: string): string {
    const v = a[id];
    return typeof v === 'string' ? v : '';
}

export function wantsFollow(a: Answers): boolean {
    return a.follow_up === 'yes' || a.follow_up === 'info_first';
}

export function matches(a: Answers, cond: Cond): boolean {
    const v = a[cond[0]];
    const want = ([] as string[]).concat(cond[1]);
    if (Array.isArray(v)) return v.some((x) => want.indexOf(x) >= 0);
    return typeof v === 'string' && want.indexOf(v) >= 0;
}

export function findQ(seg: BhSegment, id: string): Question | null {
    let hit: Question | null = null;
    FORMS[seg].forEach((scr) => scr.qs.forEach((x) => { if (x.id === id) hit = x; }));
    return hit;
}

/**
 * The options a "which matters most" question offers: what was picked in its
 * source list, minus the way-out answers like None or Not sure.
 */
export function topOpts(seg: BhSegment, a: Answers, qd: Question, otherLabel: string): Opt[] {
    const src = qd.from ? findQ(seg, qd.from) : null;
    const picked = qd.from ? a[qd.from] : null;
    if (!src || !Array.isArray(picked)) return [];
    const ex = src.exclusive || [];
    return picked
        .filter((v) => ex.indexOf(v) < 0)
        .map((v): Opt | null => {
            if (v === 'other') {
                const typed = str(a, qd.from + '_other') || otherLabel;
                return o('other', typed, typed);
            }
            return (src.opts || []).find((x) => x.v === v) || null;
        })
        .filter((x): x is Opt => x !== null);
}

export function visible(seg: BhSegment, a: Answers, qd: Question): boolean {
    if (qd.showIf && !matches(a, qd.showIf)) return false;
    if (qd.hideIf && matches(a, qd.hideIf)) return false;
    if (qd.type === 'top') return topOpts(seg, a, qd, '').length >= 2;
    return true;
}

/** True when another question on the screen depends on this one. */
export function hasDependents(scr: Screen, id: string): boolean {
    return scr.qs.some((x) => x.from === id || (x.showIf && x.showIf[0] === id) || (x.hideIf && x.hideIf[0] === id));
}

export type ErrKind = 'pick' | 'text' | 'contact' | { max: number };
export type Errors = Record<string, ErrKind>;

/** Returns the errors for a screen, keyed by question id (plus `follow_up` and `contact`). */
export function validateScreen(seg: BhSegment, a: Answers, scr: Screen): { errors: Errors; order: string[] } {
    const errors: Errors = {};
    const order: string[] = [];
    const fail = (id: string, k: ErrKind) => { errors[id] = k; order.push(id); };

    scr.qs.forEach((qd) => {
        if (!qd.required || !visible(seg, a, qd)) return;
        const v = a[qd.id];
        let ok = filled(v);
        if (ok && qd.type === 'top' && !topOpts(seg, a, qd, '').some((x) => x.v === v)) ok = false;
        if (ok && qd.other && (v === 'other' || (Array.isArray(v) && v.indexOf('other') >= 0)) && !filled(a[qd.id + '_other'])) ok = false;
        if (!ok) fail(qd.id, qd.type === 'text' || qd.type === 'textarea' ? 'text' : 'pick');
    });
    if (scr.contact) {
        if (!filled(a.follow_up)) fail('follow_up', 'pick');
        const wantsContact = scr.contact === 'full' || wantsFollow(a);
        if (wantsContact) {
            const hasReach = filled(a.c_email) || filled(a.c_phone) || filled(a.c_whatsapp);
            const hasWho = scr.contact === 'light' || (filled(a.c_name) && filled(a.c_org));
            if (!hasReach || !hasWho) fail('contact', hasWho ? 'contact' : 'text');
        }
    }
    return { errors, order };
}

function labelFor(qd: Question, v: string): string {
    const op = (qd.opts || []).find((x) => x.v === v);
    return op ? op.en : v;
}

/**
 * The answers JSON exactly as the static page built it: stable option key
 * plus English label, so the export reads without a code book and the key
 * survives a copy change.
 */
export function buildAnswers(seg: BhSegment, a: Answers): Record<string, unknown> {
    const answers: Record<string, unknown> = { form_version: FORM_VERSION };
    FORMS[seg].forEach((scr) => {
        scr.qs.forEach((qd) => {
            if (!visible(seg, a, qd)) return;
            const v = a[qd.id];
            if (!filled(v)) return;
            if (qd.type === 'top') {
                const tp = topOpts(seg, a, qd, 'Other (type which)').find((x) => x.v === v);
                answers[qd.id] = v === 'other' ? 'other: ' + str(a, qd.from + '_other') : (tp ? tp.en : v);
                answers[qd.id + '_key'] = v;
            } else if (qd.type === 'single') {
                answers[qd.id] = v === 'other' ? 'other: ' + str(a, qd.id + '_other') : labelFor(qd, String(v));
                answers[qd.id + '_key'] = v;
            } else if (qd.type === 'select') {
                answers[qd.id] = labelFor(qd, String(v));
                answers[qd.id + '_key'] = v;
                const k = String(v);
                answers[qd.id + '_country'] = k.indexOf('MX-') === 0 ? 'Mexico' : k.indexOf('US-') === 0 ? 'United States' : 'Other';
            } else if (qd.type === 'multi') {
                const arr = Array.isArray(v) ? v : [String(v)];
                answers[qd.id] = arr.map((x) => (x === 'other' ? 'other: ' + str(a, qd.id + '_other') : labelFor(qd, x)));
                answers[qd.id + '_key'] = arr;
            } else {
                answers[qd.id] = String(v).trim().slice(0, 600);
            }
        });
    });
    if (filled(a.c_whatsapp)) answers.contact_whatsapp = str(a, 'c_whatsapp').trim().slice(0, 40);
    if (filled(a.follow_up)) answers.follow_up_key = a.follow_up;
    return answers;
}

/** Human label for a single-choice answer in the given language, or the Other text. */
export function humanLabel(seg: BhSegment, a: Answers, id: string, lang: BhLang): string {
    const v = str(a, id);
    if (!v) return '';
    if (v === 'other') return str(a, id + '_other').trim();
    const qd = findQ(seg, id);
    const op = qd && (qd.opts || []).find((x) => x.v === v);
    return op ? op[lang] : v;
}
