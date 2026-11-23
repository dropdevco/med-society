# Joint Commission International (JCI)

Status: built 21 Nov 2026 · first green dry run 22 Nov 2026 (1,087 organizations) · Owner: Emilio · Adapter: `scripts/sources/adapters/jci.ts`

JCI accredits hospitals and other organizations outside the United States. A facility in our regions that JCI lists gets a **facility** badge ([ADR 0008](../adr/0008-facility-badges.md)).

## Access

Permission: letter of 21 Nov 2026, in the team vault. Scrape, store and display the accredited organizations until JCI's API exists, and **find a way in meanwhile**. That last part is recorded as `permission.waives: ['block']` ([ADR 0002](../adr/0002-source-access-policy.md)): jointcommission.org sits behind a Cloudflare check that refuses plain HTTP clients with 403, so the page is opened in a real browser with a standard Chrome identity, as CONACEM's is. Every request still sends `X-Client: MedSocietyBot`.

- **robots.txt is not waived.** It allows our agent (`User-agent: *`, `Allow: /`) and is still read every run.
- **No CAPTCHA is ever solved.** A real browser passes Cloudflare's automatic check by itself. If Cloudflare ever shows a check that wants a person, the run turns red with that reason, and the fix is on JCI's side: allowlist `MedSocietyBot/1.0 (+https://www.medsociety.one)`, or the API.

## What is stored

Everything on the list, worldwide, as for [GHA](gha.md): records outside our regions have `region` null and are never matched. US organizations are not on this list (that is The Joint Commission's own); a US record turns the run red as a sign the list changed.

## How it is read

- The page [find-accredited-international-organizations](https://www.jointcommission.org/en-us/about-us/recognizing-excellence/find-accredited-international-organizations) draws its results from Sitecore Discover.
- The adapter opens the page in the browser, finds its `_app-*.js` script, reads it in the same browser session, and takes the public search key from it **on every run**. The key is never stored or committed.
- The search itself (Sitecore's host, not behind Cloudflare) goes through the ordinary `MedSocietyBot` client.
- It asks for 100 results at a time until a short page (at most 60 pages), and turns red if the total is missing or fewer unique records came back than the total.
- robots.txt is checked against the page URL on jointcommission.org.

On 22 Nov 2026: 1,087 organizations in 78 countries (most in the United Arab Emirates, 241, and Saudi Arabia, 121). 19 in Mexico; 2 in our regions, both in Tijuana: Hospital BC and Obesity Control Center (Cyntar).

## Fields

| Field | Notes |
|---|---|
| External ID | `hco_id`, JCI's organization ID |
| Name, country, city, state, website | as published |
| Accreditations, certifications | "Program: Decision (date)", in `facts` |
| Valid from | the earliest decision date |
