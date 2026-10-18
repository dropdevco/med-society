import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../types/provider';
import { upsertJsonLd, upsertMeta } from '../utils/headTags';
import { providerJsonLd } from '../utils/structuredData';

/**
 * Sets `document.title` and the `<meta name="description">` for the loaded
 * provider, restoring whatever the app had before once the page unmounts —
 * this route is one page in a full SPA nav tree, not a standalone document,
 * so it must give the title back rather than leave the next page wearing it.
 *
 * The share tags (og:*) and the schema.org JSON-LD follow the same rule. They
 * are what a link preview, a crawler or an AI agent reads, and a visitor who
 * clicked through from the results never re-requested the document, so the
 * server-rendered copy of these tags (api/agent.ts) describes some other page.
 */
export function usePageMeta(provider: Provider | null) {
    const { t, i18n } = useTranslation();

    useEffect(() => {
        if (!provider) return;

        const previousTitle = document.title;
        const metaEl = document.querySelector('meta[name="description"]');
        const previousDescription = metaEl?.getAttribute('content') ?? null;

        const title = t('providerPage.pageTitle', {
            name: provider.name,
            defaultValue: `${provider.name} — MedSociety`,
        });
        document.title = title;

        const specialtyLabel = provider.specialty
            .map((s) => t(`specialties.${s}`, { defaultValue: s }))
            .join(', ');
        const description = t('providerPage.pageDescription', {
            name: provider.name,
            specialty: specialtyLabel,
            city: provider.city,
            defaultValue: `${provider.name} — ${specialtyLabel} in ${provider.city}. Ratings, prices, insurance and contact info on MedSociety.`,
        });
        metaEl?.setAttribute('content', description);

        const image = provider.imageUrl?.startsWith('//') ? `https:${provider.imageUrl}` : provider.imageUrl;
        const undo = [
            upsertMeta('property', 'og:title', title),
            upsertMeta('property', 'og:description', description),
            ...(image && /^https?:\/\//.test(image) ? [upsertMeta('property', 'og:image', image)] : []),
            upsertMeta('name', 'twitter:title', title),
            upsertMeta('name', 'twitter:description', description),
            upsertJsonLd('ld-provider', providerJsonLd(provider)),
        ];

        return () => {
            document.title = previousTitle;
            if (metaEl && previousDescription !== null) metaEl.setAttribute('content', previousDescription);
            undo.forEach((fn) => fn());
        };
    }, [provider, t, i18n.language]);
}
