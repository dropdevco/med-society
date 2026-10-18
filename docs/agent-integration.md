# Agent & automation integration

MedSociety is a client-rendered React app, which an AI agent or script that does not run JavaScript sees as an empty page. This is everything that makes the site usable by agents and by your automation system, and how to keep it correct. Nothing here changes what people see or do on the site.

## What is exposed

| Door | URL | For |
|---|---|---|
| REST API | `/api/v1/*` | Scripts, n8n/Make/GHL, any HTTP client. Read-only; key optional (see Access). |
| OpenAPI 3.1 | `/openapi.json` | Importing the API into a tool or an agent framework. Generated from the same table that validates requests. |
| MCP server | `/mcp` | Claude, ChatGPT, Cursor, any MCP client. Streamable HTTP, stateless, key optional. 7 read-only tools. |
| `llms.txt` / `llms-full.txt` | `/llms.txt`, `/llms-full.txt` | An LLM that is pointed at the site: what it is, how to use it, what to be careful about. |
| Readable pages | `/`, `/providers/:id`, `/pricing`, `/contact` | Crawlers and agents that fetch HTML: real `<title>`, canonical, schema.org JSON-LD and a readable copy of the page inside `#root` (React replaces it on mount). `Accept: text/markdown` or `application/json` on the same URL returns those instead. |
| Sitemaps | `/sitemap.xml` | Every provider page. |
| Discovery | `/robots.txt`, `/.well-known/api-catalog`, `/.well-known/mcp/server-card.json`, `Link` headers, `<link rel>` in `<head>` | Automatic discovery. |
| In-browser tools | `navigator.modelContext` (WebMCP) | Agents driving a browser: `search_providers`, `get_provider`, `open_provider`, `find_care_for_symptoms`. Feature-detected; a no-op where unsupported. |

In the page itself: provider cards and tiles are real links (`<a href="/providers/:id">`), each page has a `main` landmark and one `h1`, result counts are announced (`role="status"`), prices carry a machine-readable `<data value>`, `<html lang>` follows the UI language, and the search URL parameters are documented in `llms-full.txt`, so an agent can build a results URL directly.

## Access: anonymous vs key

| | Anonymous | With a key |
|---|---|---|
| Results per page / paging depth | 20 / position 100 | 50 / position 1,000 |
| Reviews per provider request | 5 | 20 |
| API requests per 10 min | 60 per IP | 600 per key |
| Symptom search (paid AI) | not available (401) | yes |

Keys are the comma-separated list in the `AGENT_API_KEYS` env var (each at least 16 characters; generate with `openssl rand -hex 24`). Send one as `Authorization: Bearer <key>` or `X-API-Key`. Give your automation system its own; remove a key from the list to revoke it. A wrong key is a 401, never a silent downgrade. With the variable unset nobody has a key, so symptom search over the API/MCP is simply off. The website's own symptom box is unaffected.

The numbers live in `ANON_ACCESS` / `KEYED_ACCESS` at the top of `api/agent.ts`; the docs, OpenAPI and error messages are generated from them. The limits are best-effort per serverless instance. For a hard guarantee, add a rate-limit rule in the Vercel dashboard (Firewall) on `/api/` and on `/api/ai-search`.

## What only browsers skip

`/`, `/providers/:id`, `/pricing` and `/contact` are rewritten to the readable-HTML function **only when the request has no `Sec-Fetch-Dest` header**. Every real browser sends it on navigation, so people get the static app exactly as before (no function, no extra latency). Crawlers, link-preview bots, `curl` and fetch-based agents don't, so they get the readable version. Browser-driving agents are real browsers: they get the app (with its landmarks, links and WebMCP tools).

## Quick examples

```bash
# Dentists in Tijuana who state they speak English, rated 4.5+
curl "https://www.medsociety.one/api/v1/providers?region=sandiego-tijuana&specialty=dentist&language=en&min_rating=4.5"

# One provider with services and prices, as Markdown
curl https://www.medsociety.one/api/v1/providers/<id> -H "Accept: text/markdown"

# Which doctor for a described problem (needs a region and a key)
curl -X POST https://www.medsociety.one/api/v1/symptoms -H "Content-Type: application/json" \
  -d '{"query":"me duele el oído","region":"elpaso-juarez","lang":"es"}'

# MCP
curl -X POST https://www.medsociety.one/mcp -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

MCP client config (Claude Desktop / Code, Cursor…): add a remote server named `medsociety` with URL `https://www.medsociety.one/mcp`. No key is needed for search; add an `Authorization: Bearer <key>` header to unlock symptom search.

## Accuracy: how the data is stated

The API says what the site means, instead of leaving an agent to guess:

- **Ratings.** `rating.value` is `null` for never-rated providers (the database stores 0). 94% of Doctoralia ratings are exactly 5.0 from few reviews, so each rating carries `count`, `reliability` (none/low/moderate/high) and `confidence_weighted_score`, the same score the site sorts by.
- **Paid placement.** Featured, then Promoted, listings rank first by default, exactly as on the site. `listing.sponsored` marks them; `paid_placement=ignore` ranks without payment.
- **"Verified".** The gold badge is a paid-plan badge (`listing.verified_badge`). The credential fact is `credentials.license_published` (the site's "Verified credentials" filter).
- **Languages.** Only reported when a clinic stated them (`languages.status`). Unknown is not "none", and the language filter never matches unstated providers.
- **Prices.** MXN, usually "from" prices, published by about a third of providers. `null` means none published. USD is approximate (17 MXN/USD, the site's own constant).
- **Strict inputs.** An invalid value is a 400 naming the parameter and listing the allowed values; unknown parameters come back as `warnings`.
- **Untrusted text.** Reviews, descriptions and service names are third-party content; every response says so, and the MCP server instructions tell the model to treat them as data.
- **Not exposed:** clinic e-mail addresses, internal columns, anything the anon key could not already read. Patients message a clinic from the form on its page; the API sends nothing.

## Keeping it in step with the site

`api/agent.ts` is self-contained (like every file in `api/`), so it carries copies of the search scoring, filters, rating math and schema.org builder from `src/`. `npx tsx scripts/agent-selftest.ts` compares them to the real modules and exercises the handler end to end (no network). Run it whenever you touch `src/utils/{search,filters,rating,region}.ts`, `src/utils/structuredData.ts`, the specialty list, or `api/agent.ts`. Adding a specialty means: `src/types/provider.ts`, the locale files, `SPECIALTY_NAMES` and `SYNONYM_GROUPS` in `api/agent.ts`.

## Operations

- One function (`api/agent.ts`) behind the rewrites in `vercel.json`; Vercel counts each file in `api/` against the plan limit (this brings it to 11 of 12 on Hobby).
- Uses the **anon** Supabase key only (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, already set). One new, optional env var: `AGENT_API_KEYS`. `PUBLIC_SITE_URL` (optional) sets the canonical origin, default `https://www.medsociety.one`. The symptom search needs what `api/ai-search.ts` needs.
- Each region's lean directory (4–9k rows) is cached in memory for 10 minutes per instance and served stale if a refresh fails. API responses are CDN-cached 5 minutes, pages 10.
- If the database is unreachable, page URLs fall back to the plain app shell, so people are never locked out. If the shell itself cannot be fetched, a plain readable page is served.
- In dev (`npm run dev`) the non-page routes work at the same URLs. To see the pre-rendered HTML of a page in dev, use `/api/agent?route=page&kind=provider&id=<uuid>`.
- Forum routes are deliberately not mentioned in robots.txt, the sitemap or llms.txt (their addresses are meant to stay unlisted); they keep their `noindex`.
