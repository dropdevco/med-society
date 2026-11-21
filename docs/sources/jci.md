# Joint Commission International (JCI)

Status: built 21 Nov 2026, **blocked** · Owner: Emilio · Adapter: `scripts/sources/adapters/jci.ts`

JCI accredits hospitals and other organizations outside the United States. A facility in our regions that JCI lists gets a **facility** badge ([ADR 0008](../adr/0008-facility-badges.md)).

## Access

Permission, received 21 Nov 2026 (reported by Emilio): scrape, store and display the accredited organizations; an API may follow. **File the letter in the team vault.** The letter as reported does not mention robots.txt or the firewall, so nothing is waived ([ADR 0002](../adr/0002-source-access-policy.md)).

**The run is red today.** jointcommission.org sits behind a Cloudflare challenge that answers our bot (`MedSocietyBot/1.0`) with 403. A 403 is a block, and the pipeline never works around one. Two ways forward, both on JCI's side:

1. JCI allowlists the user agent `MedSocietyBot/1.0 (+https://www.medsociety.one)` in Cloudflare, or
2. JCI sends the API, or an export.

If JCI's letter (or a new one) says in writing that we may use a real browser past the challenge, record it as `permission.waives: ['robots', 'block']`, as CONACEM's does, and the adapter can move to the browser reader.

## What is stored

Everything on the list, worldwide, as for [GHA](gha.md): records outside our regions have `region` null and are never matched. US organizations are not on this list (that is The Joint Commission's own); a US record turns the run red as a sign the list changed.

## How it is read

- The page [find-accredited-international-organizations](https://www.jointcommission.org/en-us/about-us/recognizing-excellence/find-accredited-international-organizations) draws its results from Sitecore Discover.
- The adapter reads the page, finds its `_app-*.js` script, and takes the public search key from it **on every run**. The key is never stored or committed.
- It asks for 100 results at a time until a short page (at most 60 pages), and turns red if the total is missing or fewer unique records came back than the total.
- robots.txt is checked against the page URL on jointcommission.org.

## Fields

| Field | Notes |
|---|---|
| External ID | `hco_id`, JCI's organization ID |
| Name, country, city, state, website | as published |
| Accreditations, certifications | "Program: Decision (date)", in `facts` |
| Valid from | the earliest decision date |
