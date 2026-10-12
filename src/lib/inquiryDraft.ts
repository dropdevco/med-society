/**
 * A message written before signing up, kept until the patient is back.
 *
 * Sending needs an account, and creating one means leaving the page — often to
 * an inbox and back through a confirmation link, which can open in a new tab.
 * Without this the patient would return to an empty box and the question they
 * had just written would be gone. localStorage (not sessionStorage) because
 * that email round trip crosses tabs; a day or two is long enough for it and
 * short enough that an abandoned medical question does not linger on a shared
 * computer.
 *
 * Every read and write is guarded: blocked site data throws on the accessor
 * itself, and a draft that cannot be kept must never break the form.
 */

export type DraftTime = 'morning' | 'afternoon' | 'evening' | 'any';

export interface InquiryDraft {
    message: string;
    time: DraftTime | null;
}

interface Stored extends InquiryDraft {
    savedAt: number;
}

const TTL_MS = 48 * 60 * 60 * 1000;
const key = (providerId: string) => `ms-inquiry-draft:${providerId}`;
const TIMES = new Set<string>(['morning', 'afternoon', 'evening', 'any']);

export function saveDraft(providerId: string, draft: InquiryDraft): void {
    try {
        if (!draft.message.trim()) {
            localStorage.removeItem(key(providerId));
            return;
        }
        const stored: Stored = { ...draft, savedAt: Date.now() };
        localStorage.setItem(key(providerId), JSON.stringify(stored));
    } catch {
        // Only the convenience is lost.
    }
}

export function loadDraft(providerId: string): InquiryDraft | null {
    try {
        const raw = localStorage.getItem(key(providerId));
        if (!raw) return null;
        const d = JSON.parse(raw) as Partial<Stored>;
        if (typeof d.message !== 'string' || !d.message.trim()) return null;
        if (typeof d.savedAt !== 'number' || Date.now() - d.savedAt > TTL_MS) {
            localStorage.removeItem(key(providerId));
            return null;
        }
        return {
            message: d.message.slice(0, 1000),
            time: typeof d.time === 'string' && TIMES.has(d.time) ? (d.time as DraftTime) : null,
        };
    } catch {
        return null;
    }
}

export function clearDraft(providerId: string): void {
    try {
        localStorage.removeItem(key(providerId));
    } catch {
        // nothing to clear
    }
}
