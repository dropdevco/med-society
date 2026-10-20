/**
 * On-device persistence for the survey: the language choice and an autosaved
 * draft, so a dropped signal or an accidental refresh picks up where the
 * person left off. Drafts expire after 24 hours.
 *
 * Keys are prefixed `ms_bh_` (new on medsociety.one; drafts from the old
 * borderhealth.dropdev.co page are intentionally not carried over).
 * Every access is wrapped: private mode or a full quota must never break the form.
 */
import type { BhLang, BhSegment } from './types';
import { FORMS } from './forms';

export type Answers = Record<string, string | string[]>;

export interface Draft {
    seg: BhSegment;
    step: number;
    a: Answers;
    startedAt: number;
    savedAt: number;
}

const DRAFT_KEY = 'ms_bh_draft';
const LANG_KEY = 'ms_bh_lang';
const DAY_MS = 24 * 3600 * 1000;

export function loadDraft(): Draft | null {
    try {
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') as Draft | null;
        if (!d || !Object.prototype.hasOwnProperty.call(FORMS, d.seg)) return null;
        if (Date.now() - (d.savedAt || 0) > DAY_MS) return null;
        return d;
    } catch {
        return null;
    }
}

export function saveDraft(d: Omit<Draft, 'savedAt'> | null): void {
    try {
        if (!d) { localStorage.removeItem(DRAFT_KEY); return; }
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: Date.now() }));
    } catch { /* storage unavailable */ }
}

export function clearDraft(): void {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
}

export function loadLang(): BhLang | null {
    try {
        const s = localStorage.getItem(LANG_KEY);
        return s === 'en' || s === 'es' ? s : null;
    } catch {
        return null;
    }
}

export function saveLang(l: BhLang): void {
    try { localStorage.setItem(LANG_KEY, l); } catch { /* storage unavailable */ }
}

/**
 * `?lang=` wins, then the last choice on this device, then the phone's language, then Spanish.
 * `spanishFirst` (the /research study page) skips the phone's language: the study is
 * Spanish-first, so a bare link opens in Spanish even on an English phone.
 */
export function pickLang(search: string, spanishFirst = false): BhLang {
    const p = (new URLSearchParams(search).get('lang') || '').toLowerCase();
    if (p === 'en' || p === 'es') return p;
    const s = loadLang();
    if (s) return s;
    if (spanishFirst) return 'es';
    try { if (/^en/i.test(navigator.language || '')) return 'en'; } catch { /* no navigator */ }
    return 'es';
}
