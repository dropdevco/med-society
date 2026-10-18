import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurveyRunner } from '../components/borderhealth/SurveyRunner';
import type { SurveyResult } from '../components/borderhealth/SurveyRunner';
import { BorderhealthOnboarding, BorderhealthResume } from '../components/borderhealth/onboarding/BorderhealthOnboarding';
import { T } from '../components/borderhealth/strings';
import { pickLang, saveLang } from '../components/borderhealth/storage';
import { authButton } from '../components/account/authStyles';
import { track } from '../components/borderhealth/track';
import { RESEARCH } from '../components/borderhealth/research';
import type { BhLang } from '../components/borderhealth/types';
import '../components/borderhealth/borderhealth.css';

let viewSent = false;

/**
 * /borderhealth — the border health access study (employer / employee /
 * provider intake), moved here from borderhealth.dropdev.co.
 *
 * The survey keeps its own reviewed copy and language state; the site
 * navbar is told about language changes so the two never disagree.
 * Providers continue into clinic onboarding after a successful send;
 * everyone else gets the study's thank-you screen.
 *
 * "A study conducted by MedSociety" — never Health Atlas, AWS, or AI.
 */
export function BorderhealthPage({ research = false }: { research?: boolean }) {
    const { i18n } = useTranslation();
    const [lang, setLangState] = useState<BhLang>(() => pickLang(window.location.search));
    const [result, setResult] = useState<SurveyResult | null>(null);
    const [submittedOnce, setSubmittedOnce] = useState(false);
    const [runKey, setRunKey] = useState(0);
    const langRef = useRef(lang);
    // Arrived from a "Get listed free" button: same form, framed as listing
    // your practice rather than as a study.
    const [listing] = useState(() => new URLSearchParams(window.location.search).get('by') === 'listing');
    const [resuming] = useState(() => new URLSearchParams(window.location.search).get('resume') === '1');

    const setLang = (l: BhLang) => {
        langRef.current = l;
        setLangState(l);
    };

    // A study page, not a directory page: keep it out of search results.
    useEffect(() => {
        // Declared first so it captures the site title before ours replaces it.
        const prevTitle = document.title;
        const meta = document.createElement('meta');
        meta.name = 'robots';
        meta.content = 'noindex';
        document.head.appendChild(meta);
        return () => {
            meta.remove();
            document.title = prevTitle;
        };
    }, []);

    // One page_view per load (the module flag survives StrictMode's double mount).
    useEffect(() => {
        if (viewSent) return;
        viewSent = true;
        const seg = (new URLSearchParams(window.location.search).get('seg') || '').toLowerCase();
        track('page_view', {
            form_segment: seg === 'employer' || seg === 'employee' || seg === 'provider' ? seg : null,
            lang: langRef.current,
            props: { listing, resuming },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const prevLang = useRef(lang);
    useEffect(() => {
        if (prevLang.current !== lang) {
            track('lang_switch', { lang, props: { from: prevLang.current } });
            prevLang.current = lang;
        }
    }, [lang]);

    // Persist the choice, title the tab, and keep the site navbar in step.
    useEffect(() => {
        saveLang(lang);
        document.title = research ? RESEARCH[lang].docTitle : T[lang].docTitle;
        if (!(i18n.language || '').toLowerCase().startsWith(lang)) void i18n.changeLanguage(lang);
    }, [lang, i18n, research]);

    // …and the other way round: a language picked in the navbar moves the survey too.
    useEffect(() => {
        const onChange = (lng: string) => {
            const l: BhLang | null = /^en/i.test(lng) ? 'en' : /^es/i.test(lng) ? 'es' : null;
            if (l && l !== langRef.current) {
                langRef.current = l;
                setLangState(l);
            }
        };
        i18n.on('languageChanged', onChange);
        return () => { i18n.off('languageChanged', onChange); };
    }, [i18n]);

    const tt = T[lang];

    const restart = () => {
        setResult(null);
        setSubmittedOnce(true);
        setRunKey((k) => k + 1);
        try { window.scrollTo(0, 0); } catch { /* ignore */ }
    };

    // Back from the confirmation email: finish the claim or listing they
    // started before confirming, instead of showing the survey again.
    if (resuming && !result) {
        return (
            <div className="bh-page">
                <div className="bh-wrap">
                    <BorderhealthResume lang={lang} />
                </div>
            </div>
        );
    }

    // Providers continue straight into onboarding with everything they told us.
    if (!research && result && result.segment === 'provider') {
        return (
            <div className="bh-page">
                <main className="bh-wrap" id="main-content">
                    <BorderhealthOnboarding submission={result.submission} lang={lang} onRestart={restart} />
                </main>
            </div>
        );
    }

    return (
        <div className={research ? 'bh-page bh-research' : 'bh-page'}>
            <div className="bh-wrap">
                <header className="bh-header">
                    <div className="bh-brand">
                        {research ? (
                            <div className="bh-logos">
                                <img className="mlcic" src="/research-brand/mlcic.svg" alt="Mike Loya Center for Innovation and Commerce, UTEP" />
                                <img className="nsf" src="/research-brand/nsf-icorps-southwest.png" alt="NSF I-Corps Hub Southwest" />
                            </div>
                        ) : (
                            <span className="bh-brand-eyebrow">MedSociety</span>
                        )}
                        <span className="bh-brand-sub">{research ? RESEARCH[lang].hsub : listing ? tt.listSub : tt.hsub}</span>
                    </div>
                    <div className="bh-lang" role="group" aria-label="Idioma / Language">
                        {(['es', 'en'] as BhLang[]).map((l) => (
                            <button
                                key={l}
                                type="button"
                                aria-pressed={lang === l}
                                onClick={() => { if (l !== lang) setLang(l); }}
                            >
                                {l.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </header>

                <main className="bh-main" id="main-content" lang={lang}>
                    {result ? (
                        <div className="bh-screen bh-done">
                            <div className="bh-tick">
                                <svg viewBox="0 0 24 24" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M4 12.5l5.2 5.2L20 7" />
                                </svg>
                            </div>
                            <h2 className="display bh-h2">{tt.doneH}</h2>
                            <p>{tt.doneP}</p>
                            {result.followed && <p>{tt.doneF}</p>}
                            <button type="button" className="press" style={{ ...authButton, marginTop: '1.2rem' }} onClick={restart}>
                                {tt.again}
                            </button>
                        </div>
                    ) : (
                        <SurveyRunner
                            key={runKey}
                            lang={lang}
                            research={research}
                            useUrlSeg={!submittedOnce}
                            onSubmitted={setResult}
                        />
                    )}
                </main>

                <footer className="bh-foot">{research ? RESEARCH[lang].foot : tt.foot}</footer>
            </div>
        </div>
    );
}
