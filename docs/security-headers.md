# Security headers and the CSP

The headers live in `vercel.json` under the `/(.*)` source. Vercel adds none of
these by default, so everything here is ours to maintain.

The Content-Security-Policy is **enforcing**, not report-only. That means a
missing origin does not warn — it blocks, and the feature simply stops working
for every visitor. Read this before changing it.

## Two things that will break the site

**1. The inline-script hashes are load-bearing.**

`index.html` has two inline scripts: the theme bootstrap (reads `localStorage`
and sets `data-theme` before paint, so there is no flash of the wrong theme)
and the Microsoft Clarity loader. Both are allowed by SHA-256 hash rather than
`'unsafe-inline'`, which is what keeps `script-src` meaningful.

A hash covers the script body **byte for byte**. Editing either script — even
reindenting it — invalidates the hash and the script stops executing: the theme
flashes, or Clarity silently stops recording. Nothing in the build warns about
this.

After touching either inline script, rebuild and recompute:

```bash
node -e '
const {createHash}=require("crypto"), fs=require("fs");
const html=fs.readFileSync("dist/index.html","utf8");
const re=/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;
for(const m of html.matchAll(re))
  console.log("sha256-"+createHash("sha256").update(m[1],"utf8").digest("base64"));
'
```

Then paste both into `script-src`. Generating them in a `prebuild` step would
remove this footgun and is worth doing the next time this file is touched.

**2. A new third-party origin needs a directive entry.**

Adding any script, font, image host, embed or API endpoint means adding its
origin to the right directive. The failure is silent in the sense that the page
still renders — only the new thing is missing — so it is easy to ship.

To check a change before deploying, serve the real build with the real headers
and watch the console:

```bash
npm run build
# scripts/csp-preview.mjs serves dist/ with the headers from vercel.json
```

Testing this way caught two breakages that would otherwise have reached
production: the contact form's `form_embed.js` (the GHL embed loads a script,
not just an iframe) and Clarity's pixel, which lives on a different subdomain
from its loader.

## What the policy allows, and why

| Directive | Why these origins |
|---|---|
| `script-src` | Two inline hashes; Google Maps; Clarity; Contentsquare; `links.mylayerone.com` for the GHL contact-form embed |
| `style-src` | Keeps `'unsafe-inline'` — Google Maps injects `<style>` blocks. A known accepted gap, not an oversight |
| `img-src` | Google (maps tiles, place photos via `lh3`), the two S3 buckets, Supabase storage, Clarity and Contentsquare beacons; `data:` and `blob:` for generated images |
| `connect-src` | Supabase over HTTPS and WSS; Maps; Clarity; Contentsquare. PostHog needs **no** entry — `api_host` is `/ingest` in production, which is same-origin through the rewrites in `vercel.json` |
| `frame-src` | The GHL form, YouTube, Google |
| `frame-ancestors 'none'` | Nothing should embed this site. Paired with `X-Frame-Options: DENY` for older clients |

`Permissions-Policy` denies the device APIs we do not use but **allows
`geolocation=(self)`** — `MapView.tsx` calls `getCurrentPosition` for "near me"
search, and the usual deny-everything baseline would break it.

`X-DNS-Prefetch-Control: off` is deliberately **not** set, even though OWASP
recommends it: `index.html` has intentional `dns-prefetch` hints for S3,
Supabase and Google Fonts, and disabling prefetch would undo that.

## Deliberately blocked: `c.bing.com`

Microsoft Clarity tries to load `https://c.bing.com/c.gif?ctsa=mr&CtsSyncId=…`,
which is an **advertising-identifier sync** between Clarity and Bing, not part
of Clarity's analytics. It is blocked, and that is the intended behaviour:

- Clarity's session recording and heatmaps work fine without it (verified —
  `window.clarity` loads and records with this blocked).
- What it stops is Microsoft correlating this site's visitors with Bing ad
  profiles. On a healthcare marketplace that is a privacy exposure we do not
  need, and one a privacy review would reasonably ask about.

So the console will show one blocked-image CSP error on every page load. **That
is expected. Do not "fix" it by adding `c.bing.com` to `img-src`.** If the
decision is ever revisited, it should be a deliberate privacy call, not a
console-cleanup.

## Not yet exercised under enforcement

The policy was tested against the home page, `/contact`, `/pricing` and two
provider profiles. These were **not** tested and could hold violations that now
fail closed rather than merely reporting:

- the admin dashboard
- the forums
- the borderhealth onboarding flow
- a live billing checkout against GHL payment links

Worth walking each one with the console open. Adding a `report-uri` pointing at
an `/api/*` route would make any remaining breakage visible instead of silent,
and is the obvious next step — enforcing without reporting means we learn about
gaps from users rather than from telemetry.

## Related

`docs/privacy-policy-analytics-brief.md` covers what the policy needs to say
about analytics. Note that it describes **PostHog only**, while the site also
runs Microsoft Clarity and Contentsquare — both of which do session recording.
Those two are unnamed processors in that brief and probably need adding.
