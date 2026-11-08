# Doctor websites: how a site is made, and the standard it has to meet

A doctor on the US$99 plan gets `<name>.medsociety.one`. It is **not** a copy of their MedSociety
listing. The listing is a directory entry that helps a patient compare doctors; the site is
what the doctor shares on WhatsApp, Instagram and a business card, so it has to sell the
practice and be something they are proud to send.

```
doctor_sites row ─┐
                  ├─▶ api/agent.ts?route=site ─▶ finished HTML (no JavaScript, no app)
listing (provider)┘            ▲
                               │ rewrite
        middleware.ts  <sub>.medsociety.one ─▶ route=site&sub=<sub>
```

- **One wildcard, no per-site deployment.** DNS has a single `*` CNAME at Porkbun
  (`cname.vercel-dns.com`). Each site's subdomain is added to the Vercel project when the site is
  created; Vercel then issues its certificate. `middleware.ts` has to be middleware, not a
  `vercel.json` rewrite, because rewrites run after the filesystem and `/` would be answered by
  the app's own `index.html`.
- **The plan is read at render time**, never copied. A site renders while `providers.tier` is
  `featured` (the US$99 plan) or `doctor_sites.comped` is true. When the plan lapses the site
  redirects to the listing. A lost billing webhook can therefore never leave a site up or down
  against the plan. See `api/billing.ts` for the "paid through + 4 days" rule.
- **`status`**: `preview` renders but is `noindex` and out of the sitemap, `active` is indexed,
  `suspended` does not render. Every new site starts as `preview` until someone has looked at it.

## Creating a site (until the plan hook exists, by hand)

1. Insert the row: `provider_id`, `subdomain` (lowercase, 3–40 characters, not reserved; the table
   checks both), `status = 'preview'`, `comped` only for demos or agreed first sites.
2. Add `<subdomain>.medsociety.one` to the Vercel project `medsociety-marketplace`.
3. Open the site, review it against the checklist below, then set `status = 'active'`.

## What the site must be (the design standard)

Every site is built to this brief. It was produced with the `frontend-studio` skill and is the
reference for any change to the template.

**Design read:** a shareable marketing site for a private doctor, aimed at patients who arrive
from WhatsApp, Instagram or Google. Editorial and warm, not clinical.
**Dials:** DESIGN_VARIANCE 7, MOTION_INTENSITY 5, VISUAL_DENSITY 3.

- **Marketing, not a data sheet.** A benefit-led headline, a lead line, one primary action, social
  proof as large numbers and a featured quote, then services, reviews, how to start, FAQ and a
  closing call to action with a "share on WhatsApp" button. The sections are in `renderSite`.
- **A look per practice.** `SITE_THEMES` holds seven palettes chosen by specialty
  (`SITE_THEME_OF`). Each accent keeps at least 6:1 contrast on its background and with white
  text on it; check that before adding or changing a colour.
- **Type:** Fraunces (display) and Geist (text), self-hosted from `public/fonts` (SIL OFL). Never
  link Google Fonts. Banned: Inter, Roboto, Arial, Open Sans, Helvetica.
- **Details that make it read as designed:** pill eyebrow tags, double-bezel cards, buttons with
  the arrow in its own circle, section padding of at least `clamp(72px, 11vw, 150px)`, an arch
  portrait with a floating rating card, a floating pill navigation bar and a sticky call
  to action on phones.
- **Motion is CSS only:** a staggered load-in and scroll-driven reveals (`animation-timeline:
  view()`, with a plain static fallback). Only `transform` and `opacity` animate, with custom
  `cubic-bezier` easing, and `prefers-reduced-motion` turns it all off. No GSAP and no
  scripts: the Content-Security-Policy is `default-src 'none'` plus images, inline styles and our
  own fonts.
- **Honest copy.** Every claim comes from the listing (rating, review count, published prices,
  published licence, languages, insurers, address). Fallback wording states facts; it never invents
  experience, awards or results. Reviews are shown as the patients wrote them.
- **Mobile first:** one column under 860px, no horizontal scroll, `100dvh` for the hero.
- **SEO and sharing:** real HTML, a canonical URL, `hreflang` for both languages, schema.org
  (provider plus `FAQPage`), Open Graph with the doctor's photo, and a per-site `robots.txt` and
  `sitemap.xml`.

## The content step (what makes a site better than the fallback)

`doctor_sites.content` holds copy the listing cannot supply. Every field is optional and each
falls back to wording built from the listing, so a site is always complete.

`kicker` replaces the specialty label when the place is not a doctor (the directory has no
"recovery center" category, so the listing says "general"). `place` is the noun the template uses
for the place ("consultorio" / "practice" by default). With no photo the hero shows the rating
instead, and with no published prices the services list drops its price column.

```json
{
  "kicker":     { "es": "Centro de recuperación posoperatoria", "en": "Post-surgery recovery center" },
  "place":      { "es": "centro", "en": "center" },
  "headline":   { "es": "…", "en": "…" },
  "lead":       { "es": "…", "en": "…" },
  "about":      { "es": "…", "en": "…" },
  "highlights": { "es": [{ "title": "…", "body": "…" }], "en": [] },
  "faq":        { "es": [{ "q": "…", "a": "…" }],        "en": [] },
  "gallery":    false,
  "brand":      { "bg": "#fbf7f4", "soft": "#f2e4e2", "accent": "#701236", "ink": "#1d1e20", "warm": "#dd7d30", "logo": "https://…" },
  "images":     { "hero": "https://…",
                  "story": [{ "src": "https://…", "title": { "es": "…", "en": "…" }, "caption": { "es": "…", "en": "…" } }],
                  "more":  [{ "src": "https://…", "caption": { "es": "…", "en": "…" } }] },
  "icons":      ["https://…"]
}
```

When the content is written by AI at activation, give the model only the listing's facts and these
rules: write for a patient, in the doctor's voice only where the listing supports it, state
nothing the listing does not (no years of experience, awards, techniques or guarantees), keep the
headline under 12 words, and return both languages. Treat the result as a draft: the doctor
approves it before the site goes from `preview` to `active`.

### Brand and photos (what makes it look like *their* site)

`brand` replaces the specialty palette with the practice's own colours (`#rrggbb` only; each missing
colour keeps the specialty one) and sets the logo shown in the navigation. `warm` is a second
brand colour used only for small decoration, never for text. `images.hero` turns the opening into a
full-bleed photo; `images.story` is a scroll sequence, one photo per screen stacking over the last
with its caption arriving late, in the order a visitor would walk through the place; `images.more`
is a captioned details grid. `icons` gives each service an icon, in the listing's service order.
All image URLs must be `https`. They are hotlinked from the practice's own website for the first
preview; the owner-upload path (Supabase Storage, from the intake form) replaces that, and
Google Maps photos are never used. Pick photos that are sharp, show the place and no identifiable
patients, and write captions that state only what the photo shows or the listing says.

### The owner's form (dashboard "Website" tab)

The tab appears for a listing that has a `doctor_sites` row. It edits colours (the page tints
are derived from the main colour), the logo, the photo sequence with a title and caption per
photo, the cover photo, and the headline, lead and about text, in the language the owner is using.
Photos upload to `clinic-photos/<provider_id>/site/`. Saving calls `update_my_site` (migration
0036), a security-definer function that merges only `brand`, `images`, `headline`, `lead` and
`about` into the owner's own row. Status, subdomain, plan and icons stay with us, and a site
stays `preview` until the team sets it to `active`. A text written in one language only is shown in
both. Still to build: the GHL email that links to this tab after the plan is bought.

## Review checklist before a site goes live

- [ ] The doctor agreed to have a site.
- [ ] Photo: a clear portrait, not a logo or a placeholder.
- [ ] Gallery: scraped photos are not always fit to show (promotional images of equipment, other
      people). Set `content.gallery` to `false` when in doubt.
- [ ] Services match the specialty (a listing can carry services from another specialty).
- [ ] Headline, lead and about read well in both languages.
- [ ] Contact: the WhatsApp or phone button reaches the practice; without either it falls back to
      the MedSociety message form, which needs a signed-in patient.
- [ ] Open the site on a phone.
