import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import es from './locales/es.json';

i18n
    .use(LanguageDetector)       // auto-detect browser language
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: en },
            es: { translation: es },
        },
        fallbackLng: 'en',
        supportedLngs: ['en', 'es'],
        // Detection order: localStorage → browser language
        detection: {
            order: ['localStorage', 'navigator'],
            caches: ['localStorage'],
            lookupLocalStorage: 'medsociety-language',
        },
        interpolation: {
            escapeValue: false, // React already escapes
        },
    });

/**
 * Keep `<html lang>` in step with the UI language. index.html ships "en", and
 * without this a screen reader kept reading the Spanish site with English
 * pronunciation rules (and the browser offered to "translate from English").
 * Registered before any change can fire; the detector has already resolved
 * the initial language synchronously by the time init returns.
 */
const syncHtmlLang = (lng: string | undefined) => {
    if (typeof document === 'undefined' || !lng) return;
    document.documentElement.lang = lng.toLowerCase().startsWith('es') ? 'es' : 'en';
};
i18n.on('languageChanged', syncHtmlLang);
syncHtmlLang(i18n.resolvedLanguage ?? i18n.language);

export default i18n;
