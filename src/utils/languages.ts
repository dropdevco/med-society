/**
 * Spoken languages, as ISO 639-1 codes.
 *
 * Most of the directory stores codes ('es', 'en'), but the Tijuana sweep
 * stored Doctoralia's Spanish names verbatim ('Español', 'Inglés',
 * 'Francés'…). Left as-is, the language filter offered "Inglés" beside
 * "English" as two options and `lang=en` silently skipped every Tijuana
 * clinic. Normalising on load puts every row on the same codes.
 */

/** Folded (lowercase, no accents) language name → ISO 639-1 code. */
const NAME_TO_CODE: Record<string, string> = {
    espanol: 'es', spanish: 'es', castellano: 'es',
    ingles: 'en', english: 'en',
    frances: 'fr', french: 'fr',
    italiano: 'it', italian: 'it',
    aleman: 'de', german: 'de',
    portugues: 'pt', portuguese: 'pt',
    ruso: 'ru', russian: 'ru',
    catalan: 'ca',
    japones: 'ja', japanese: 'ja',
    chino: 'zh', mandarin: 'zh', chinese: 'zh',
    coreano: 'ko', korean: 'ko',
    arabe: 'ar', arabic: 'ar',
    hebreo: 'he', hebrew: 'he',
};

const fold = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * One stored language value as a code. Two-letter values are already codes;
 * a name we do not know is kept (folded) rather than dropped, so it still
 * shows up and can be added to the table.
 */
export function toLanguageCode(raw: unknown): string {
    const f = fold(String(raw ?? ''));
    if (/^[a-z]{2}$/.test(f)) return f;
    return NAME_TO_CODE[f] ?? f;
}

/** A provider's languages as distinct codes, in their stored order. */
export function normalizeLanguages(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map(toLanguageCode).filter(Boolean))];
}

const displayNames = new Map<string, Intl.DisplayNames | null>();

/**
 * "English" / "Inglés" for 'en', in the UI's own language. Intl rather than an
 * i18n key per language, so a code the data grows into (say 'ko') is labelled
 * without a translation file edit; falls back to the bare code.
 */
export function languageName(code: string, uiLanguage: string | undefined): string {
    const locale = uiLanguage?.toLowerCase().startsWith('es') ? 'es' : 'en';
    let names = displayNames.get(locale);
    if (names === undefined) {
        try {
            names = new Intl.DisplayNames([locale], { type: 'language' });
        } catch {
            names = null;
        }
        displayNames.set(locale, names);
    }
    try {
        const name = names?.of(code);
        if (name && name !== code) return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
    } catch {
        // Not a valid language tag (an unknown stored name); show it as-is.
    }
    return code.length === 2 ? code.toUpperCase() : code;
}
