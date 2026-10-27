import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const FORM_ID = 'Y7U63Qe8XW7rQnihETT0';
const FORM_SRC = `https://links.mylayerone.com/widget/form/${FORM_ID}`;
const SCRIPT_SRC = 'https://links.mylayerone.com/js/form_embed.js';
const FORM_HEIGHT = 864;

/**
 * Public contact page: LayerOne embed (name, phone, email, SMS opt-in).
 * The widget script resizes the iframe; we only load it once per visit.
 */
export function ContactPage() {
    const { t } = useTranslation();

    useEffect(() => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
        if (existing) return;

        const script = document.createElement('script');
        script.src = SCRIPT_SRC;
        script.async = true;
        document.body.appendChild(script);

        return () => {
            script.remove();
        };
    }, []);

    return (
        <div style={{ paddingTop: 68 }}>
            <section
                style={{
                    maxWidth: 640,
                    margin: '0 auto',
                    padding: '2.5rem 1.25rem 3rem',
                }}
            >
                <h1
                    style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'clamp(1.75rem, 4vw, 2.25rem)',
                        fontWeight: 400,
                        color: 'var(--ink)',
                        margin: '0 0 1.5rem',
                        textAlign: 'center',
                        letterSpacing: '-0.02em',
                    }}
                >
                    {t('contact.title')}
                </h1>

                <div
                    style={{
                        width: '100%',
                        minHeight: FORM_HEIGHT,
                        borderRadius: 3,
                        overflow: 'hidden',
                    }}
                >
                    <iframe
                        src={FORM_SRC}
                        style={{ width: '100%', height: '100%', minHeight: FORM_HEIGHT, border: 'none', borderRadius: 3 }}
                        id={`inline-${FORM_ID}`}
                        data-layout="{'id':'INLINE'}"
                        data-trigger-type="alwaysShow"
                        data-trigger-value=""
                        data-activation-type="alwaysActivated"
                        data-activation-value=""
                        data-deactivation-type="neverDeactivate"
                        data-deactivation-value=""
                        data-form-name="Contact Form"
                        data-height={String(FORM_HEIGHT)}
                        data-layout-iframe-id={`inline-${FORM_ID}`}
                        data-form-id={FORM_ID}
                        data-cookie-consent="true"
                        data-cookie-consent-provider="auto"
                        title="Contact Form"
                    />
                </div>
            </section>
        </div>
    );
}
