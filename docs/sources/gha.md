# Global Healthcare Accreditation (GHA)

Status: built 21 Nov 2026 · Owner: Emilio · Adapter: `scripts/sources/adapters/gha.ts`

GHA accredits and certifies hospitals, clinics, medical-travel facilitators, and hotels and resorts for medical travellers. A facility in our regions that GHA lists gets a **facility** badge ([ADR 0008](../adr/0008-facility-badges.md)).

## Access

Permission: letter of 21 Nov 2026, in the team vault. Scrape, store and display the accredited and certified organizations; GHA said an API may follow and asked us to scrape until then. robots.txt allows us and is still read every run; nothing needs waiving.

Logo use is **not** authorized, so `organizations.logo_permission_at` stays empty and no logo shows.

## What is stored

**Everything on the list, worldwide.** A record outside our two regions is stored with `region` null and its country in `facts`; it is never matched to a listing ([`scripts/sources/lib/places.ts`](../../scripts/sources/lib/places.ts)). On 21 Nov 2026 the page held 39 organizations in 16 countries; 3 were in Tijuana.

## How it is read

- One Webflow page, [accredited-and-certified-organizations…](https://www.globalhealthcareaccreditation.com/accredited-and-certified-organizations-healthcare-providers-and-hotels), with one tab per program. The tab label comes from the tab link (the first tab's label has no class).
- One card per organization per program. Cards with the same name are merged into one record that lists every program.
- Under each seal is a program name and a date line: "Since September 20, 2017", "Accredited Since December 10, 2024", a term "September 18, 2017 – September 18, 2020", or "Since A - B". Ordinals ("October 15th") are read. A seal with a date but no name takes the tab's name.
- The run turns red if a list is paged (`w-pagination-next`) or shows 100 cards, Webflow's limit without paging, because records could be cut off.

## Fields

| Field | Where | Notes |
|---|---|---|
| External ID | slug of the name | GHA has no ID on the page. A rename looks like one removal and one addition |
| Name | card `h2` | |
| Country, city | the plain `address-container` ("Thailand \| Bangkok") | Country spelled one way (`normalizeCountry`). One card has "Kyiv" in the country cell; it is stored as published |
| Address, languages, website | `address-container location / language / website` | 12 of 39 had no website |
| Programs | the seals | `facts.programs`, for example "Hospital Accreditation (since 2017-09-20)" |
| Valid from, valid to | the earliest date; the latest end | `validTo` is null while any program has no end date |

## When the API arrives

Replace `parse` with `collect` against the API, keep the slug, and keep the external ID stable (map the API's ID to the old slug for one run) so no record looks removed and re-added.
