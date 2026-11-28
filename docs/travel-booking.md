# Travel bookings: hotels and flights

How MedSociety gets paid when a patient books part of their trip through a partner, and the plan for each part. **Hotels** (Booking.com through CJ) are built and waiting for an affiliate link; **flights** have a first version built (a search tab, hidden for now, and the "Getting here" guide), with the plan below. In both we only send the visitor out to the partner: no booking, no payment, no prices of our own on our pages.

The rest of this page is the Booking.com (hotels) sign-up, step by step. Until it is done, "Check rates" works but earns nothing. The code is ready: when the steps are done, turning commission on is one environment variable and a redeploy. The flights plan is at the end, under [Flights](#flights-plan).

Last checked 19 Nov 2026. Booking.com changes this programme often, so re-check step 2 before starting.

**Contents:** [Hotel affiliate sign-up](#how-it-works-now) · [Booking the whole trip from our site](#booking-the-whole-trip-from-our-site) (what we can do now, where the booking APIs come from, build order, legal) · [Flights plan and affiliate sign-up](#flights-plan)

## How it works now

Booking.com no longer signs affiliates up directly. Its [affiliate page](https://www.booking.com/affiliate-program/v2/index.html) says to "Select your region and complete your registration with CJ", and its Register button opens [CJ's Booking.com partner page](https://www.cj.com/en-gb/publisher/partners/booking.com). CJ (Commission Junction) is the affiliate network that tracks clicks and pays us. Booking.com, not CJ, approves or declines us.

Not confirmed (secondary sources only, check in CJ after approval):
- **Commission:** reported as 25–40% of what Booking.com earns from the hotel, tiered by volume. It is not a percentage of the booking. Cancelled stays pay nothing.
- **Payment:** reported as monthly, about 20 days after month end, minimum US$50 by direct deposit or Payoneer. No PayPal.
- **Awin:** Booking.com used to route some regions through Awin. One source says that ended on 30 June 2026. Use CJ.

## Before applying

1. **Hotels on the site.** The reviewer looks at medsociety.one. `/hotels?region=sandiego-tijuana` and `/hotels?region=elpaso-juarez` should list real hotels with the commission disclosure. That is done (scripts/hotels/find.ts).
2. **Who gets paid.** Decide the legal entity and have ready:
   - legal name, address and tax ID (EIN or RFC)
   - the tax form: **W-9** for a US company, **W-8BEN-E** for a Mexican one
   - bank account or Payoneer details
3. **What to tell them.** Short and honest:
   - **Site:** https://www.medsociety.one, a bilingual directory of doctors and clinics in Tijuana and Ciudad Juárez for US patients who cross the border for treatment.
   - **Hotels:** a curated list near the clinics, shown on each clinic's page and on `/hotels`. Booking happens on Booking.com.
   - **Promotion:** our own site and organic search. No paid search on Booking.com's brand, no coupons, no email lists.
   - **Traffic:** monthly visitors and pageviews, from PostHog's web analytics for medsociety.one.

## Steps

1. Open [booking.com/affiliate-program](https://www.booking.com/affiliate-program/v2/index.html) and click **Register**. It opens CJ's Booking.com page.
2. **Create a CJ publisher account:**
   - company and contact details
   - website: `https://www.medsociety.one`
   - promotional method: content or editorial website
   - tax form and payment method
   
   Use the company's shared address, not a personal one, so the account survives people leaving.
3. **Apply to the Booking.com programme** inside CJ (Advertisers → search "Booking.com" → Apply). Approval can take days. If Booking.com declines, CJ shows the reason. The usual cause is a thin site, which publishing more hotels fixes.
4. **After approval, read the programme terms in CJ.** Write the actual commission, the click window (how long after a click a booking still counts) and the payment terms into the "Record" section below.
5. **Make one deep link.** In CJ, go to Links → Deep Link Generator, choose Booking.com, and paste any Booking.com page, for example `https://www.booking.com/searchresults.html?ss=Tijuana`. CJ returns a tracking link that wraps it, usually shaped like `https://www.<cj-domain>/click-<publisher id>-<ad id>?url=<the Booking.com link>`.
6. **Turn it into our template.** Take that link and replace the encoded Booking.com address after `url=` with `{url}`. Keep everything else exactly as CJ gave it.
   ```
   https://www.anrdoezrs.net/click-1234567-15734286?url={url}
   ```
   (Made-up numbers; yours come from CJ.)
7. **Set it in Vercel:** Project → Settings → Environment Variables → `VITE_HOTEL_AFFILIATE_LINK` = the template, for **Production and Preview**. Then redeploy: it is read at build time.
8. **Check it on the live site:**
   - On `/hotels`, hover "Check rates". The link now starts with CJ's domain, and the page source shows `rel="sponsored"`.
   - Click through once. It should land on Booking.com with our dates and language.
   - Within a day, CJ's Reports show the click.

## Rules to keep

- No bidding on "Booking.com", "Booking" or misspellings in Google Ads or any paid search.
- No iframes or hidden frames of Booking.com pages.
- Keep the disclosure "We may earn a commission when you book". It is on every hotel list and in the server-rendered `/hotels` page.
- No made-up prices or availability on our pages: rates are only ever on Booking.com.

## Record (fill in after approval)

| | |
|---|---|
| CJ publisher ID | |
| Approved on | |
| Commission | |
| Click window | |
| Payment terms | |
| Template set in Vercel on | |
| Account owner (shared login in the team vault, never in this repo) | |

## How the code uses it

[`src/utils/hotelLinks.ts`](../src/utils/hotelLinks.ts) builds every "Check rates" link:
1. It takes the hotel's Booking.com URL and adds `lang`, our `label=medsociety` and the patient's dates when they gave valid ones.
2. With `VITE_HOTEL_AFFILIATE_LINK` set, it puts that URL, encoded, into the `{url}` slot. A template that isn't https, or doesn't have exactly one `{url}`, is ignored rather than producing broken links.
3. Without it, it falls back to `VITE_BOOKING_AFFILIATE_ID` (`aid=`, from the old direct programme), and otherwise to the plain link.

A hotel's own website, for hotels with no Booking.com link, is never wrapped. Checks: `npx tsx scripts/hotels-selftest.ts`.


## Booking the whole trip from our site

Researched 28 November 2026. The goal: a patient books the hotel and the flight from medsociety.one. Not decided yet, and nothing in this section is built except what "Switch on what is already built" lists.

The affiliate link alone does not do this: it sends the patient to the partner, which takes the booking and the payment and pays us a commission.

**Recommendation: earn from links now, then pilot in-site hotel booking with LiteAPI (Nuitee) as merchant of record, and keep flights as outbound affiliate links until volume and legal registration justify Duffel.** LiteAPI is the only hotel booking API found that is self-serve all the way to production, and it can take the guest's payment so MedSociety never handles cards. Flights are harder: Amadeus closed its self-service portal, Kiwi's API is invitation-only, and Duffel needs account review and leaves first-line support with the seller. Hotel-only sales also appear to fall outside California's seller-of-travel definition, while selling air does not. Payment handled by a partner does not remove advertising, disclosure or registration duties. This document is not legal advice. Research date: 28 November 2026; **(unverified)** marks anything not confirmed on a primary source.

### Switch on what is already built

The repository is further along than "two affiliate links". The checked-out tree (branch `feat/flights-kids-f4`, partly uncommitted when this was researched; production deployment not checked) has curated hotels with "Check rates" links, a Flights tab hidden behind `VITE_FLIGHTS_TAB`, a `/getting-here` guide, and a "recently found fare" feature that is off by default. No booking API is needed for any of the steps below.

| Order | Action now | Where |
|---|---|---|
| 1 | Apply to Booking.com through CJ, then set the deep-link template and redeploy | `VITE_HOTEL_AFFILIATE_LINK`, `docs/travel-booking.md` |
| 2 | Join Travelpayouts, set the flight template, confirm a click registers, then show the tab | `VITE_FLIGHT_AFFILIATE_LINK`, `VITE_FLIGHTS_TAB=on` |
| 3 | Keep the commission disclosure next to every paid link, in English and Spanish, and add it wherever a new one appears | hotel lists, Flights tab, `/getting-here` once it earns |
| 4 | Keep `VITE_FLIGHT_FARES` off until a lawyer has reviewed showing fares | `api/flight-fares.ts`, `RecentFare.tsx` |
| 5 | Review demand: hotel clicks by clinic, region and border side; flight searches by route | PostHog `hotel_outbound_click`, `flight_search` |
| 6 | Optionally trial a Stay22 map near clinics, after checking it against CJ's terms **(unverified)** | new component |

The FTC requires affiliate disclosure that is clear and close to the link; "affiliate link" alone is generally not enough ([FTC](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)). While affiliate-only, avoid "we book your flights" or "we arrange your travel": California's definition includes advertising that you can arrange air travel ([statute §17550.1](https://oag.ca.gov/sites/all/files/agweb/pdfs/travel/sot-statute-17550-59.pdf)). No regulator guidance was found that gives affiliate sites a safe harbour.

Expect modest money. Booking.com commission is reported as 25–40% of Booking.com's own commission ([Track360](https://track360.io/blog/booking-com-affiliate-partner-program-operator-teardown-2026)) or a flat 4% through Awin ([Awin](https://www.awin.com/us/advertisers/partner/booking.com)), both **(unverified)** until CJ shows the terms. Aviasales is listed at about 1.1% of the ticket ([Travelpayouts](https://travelpayouts.com/en/offers/aviasales-affiliate-program)). [Stay22](https://stay22.com/faq) is free, needs no approval and starts at a 30% commission split. Expedia's creator programme pays [4% on hotels](https://creator.expediagroup.com/commission-terms?locale=en_US).

The fare feature deserves caution. Its data comes from a cache of other people's searches, not live availability ([Travelpayouts docs](https://travelpayouts-data-api.readthedocs.io/en/latest/)), and sources disagree on whether it covers 48 hours or about 7 days. A displayed airfare brings in the federal rule that a stated price must be the entire price ([91 FR 39932](https://www.govinfo.gov/content/pkg/FR-2026-07-01/pdf/2026-13294.pdf)); whether it reaches a cached "from" price on a link-out site is **(unverified)**. Before switching it on, show when the price was found, filter on `origin_airport` as well as destination, send `market` explicitly, and test the `one_way=false` behaviour with a real token. Coverage for Tijuana and Juárez routes is unknown.

### Where the booking APIs come from

#### Hotels

| Provider and sign-up | Access and approval | Merchant of record | Cost and earnings | Fit |
|---|---|---|---|---|
| **LiteAPI** ([connect.nuitee.com](https://connect.nuitee.com)) | Self-serve; sandbox free; card on file unlocks live key ([FAQ](https://docs.nuitee.com/docs/faq)) | Nuitee (payment SDK or whitelabel), or you ([docs](https://docs.nuitee.com/docs/revenue-management-and-commission)) | You set margin; core calls free within limits ([pricing](https://docs.nuitee.com/reference/api-pricing-usage-costs)) | **Start here** |
| **Duffel Stays** ([duffel.com](https://duffel.com/docs/guides/getting-started-with-stays)) | Request access; card payments approved separately | Hotel on card payments ([docs](https://duffel.com/docs/guides/paying-with-customer-cards)) | Profit share, rate unpublished ([pricing](https://duffel.com/pricing)) | Later, if using Duffel for flights |
| **Expedia Rapid** ([partner page](https://partner.expediagroup.com/en-us/solutions/build-your-travel-experience/rapid-api)) | Partner application and [launch review](https://developers.expediagroup.com/rapid/setup/launch-requirements/b2c-standalone) | Expedia or the property ([docs](https://developers.expediagroup.com/rapid/lodging/booking/property-collect)) | Not published | Needs volume (judgement) |
| **Booking.com Demand** ([prerequisites](https://developers.booking.com/demand/docs/getting-started/prerequisites)) | Contract as Managed Affiliate Partner; CJ membership is not that status ([secondary](https://vorplabs.com/agent-tools/booking-demand-api), **unverified**) | **Unverified** | **Unverified** | Not now |
| **Hotelbeds** ([developer.hotelbeds.com](https://developer.hotelbeds.com/)) | Free test key, 50 requests a day; certification and contract | **Unverified** | Set by contract | B2B wholesaler; not now |
| **RateHawk** ([API page](https://www.ratehawk.com/journey/api/)) | Free key, [certification](https://docs.emergingtravel.com/docs/integration-requirements/) | Depends on payment type | Affiliates "5% or more" ([old post](https://blog.ratehawk.com/tools-for-affiliates/), **unverified**) | Backup option |

With LiteAPI's `margin`, 15 adds 15% to the net rate, and payouts are weekly; its pages differ on whether eligibility starts at check-in or check-out ([revenue](https://docs.nuitee.com/docs/revenue-management-and-commission), [whitelabel](https://docs.nuitee.com/docs/whitelabel-booking-site)). Prices must respect a public selling-price floor. Rates, prebook and book are free within the terms and a 5,000:1 search-to-book ratio. On an illustrative $300 stay, a 10% margin yields $30 against $12 at 4%, in exchange for more customer responsibility.

Three things about LiteAPI remain **(unverified)**: its refund, chargeback and cancellation-liability terms; payouts to a Mexican entity; and acceptance of a company with no travel registration. No provider publishes coverage for these four cities, so test it directly.

#### Flights

| Option and sign-up | Access and approval | Merchant of record | Cost | Fit |
|---|---|---|---|---|
| **Affiliate / white label** ([travelpayouts.com](https://www.travelpayouts.com)) | Light; some programmes review applications | The booking site | None; you earn commission | **Use now** |
| **Duffel Links** ([guide](https://duffel.com/docs/guides/duffel-links)) | Duffel review; supported countries only **(unverified)** | Duffel states it is not ([agreement cl. 17.3](https://duffel.com/services-agreement)) | **Unverified** | First step beyond links |
| **Duffel API** ([app.duffel.com](https://app.duffel.com), join path unverified) | Self-serve test; live after [review](https://duffel.com/services-agreement) | Airline on card pass-through ([docs](https://duffel.com/docs/guides/collecting-and-making-payments)); with Duffel Payments **unverified** | $3 per order, 1% managed content, $2 per paid extra, plus processing and FX ([pricing](https://duffel.com/pricing)) | Later |
| **Amadeus Enterprise** ([developers.amadeus.com](https://developers.amadeus.com)) | Sales contract; self-service [shut 17 July 2026](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers) (search summary) | **Unverified** | Not public | No |
| **Kiwi Tequila** ([portal](https://tequila.kiwi.com/portal)) | [Invitation only](https://media.kiwi.com/articles-and-interviews/better-for-business-kiwi-com-takes-a-new-approach-to-partnerships/) | **Unverified** | **Unverified** | No |
| **Sabre / Travelport** | Contract; IATA/ARC or a host agency ([secondary](https://www.altexsoft.com/blog/travelport-api-integration/)) | The agency | Not public | No |

Duffel's "Managed Content" lets a seller ticket under Duffel's accreditation ([agreement cl. 14.1](https://duffel.com/services-agreement)). The same agreement makes the seller first-line support, relays airline schedule changes for the seller to act on, gives Duffel no control over refund timing, and puts chargebacks outside Managed Content on the seller. A deposit can be required. Medical travellers move dates, and Duffel's [Volaris page](https://duffel.com/flights/airlines/volaris) showed changes and cancellations as "coming soon" **(page may be stale)**. VivaAerobus was not found on Duffel.

### Build in this order once you decide on APIs

This reverses current repository documents: `docs/travel-booking.md` says on-site booking is "not planned", and `docs/travel-booking-data.md` says not to become an online travel agency. The team should decide this explicitly. A partner as merchant of record is the narrowest way to change course.

#### Hotels

| Step | Build or decide | Done when |
|---|---|---|
| 1 | Name the legal entity. Get Nuitee's written answers on refunds, chargebacks, support, payouts, registrations and whether MedSociety acts as its agent. Take them to a travel lawyer | Answers on file |
| 2 | Create a sandbox account and search all four cities. Match the published hotels in `public.hotels` | Match rate known; suggested bar is most Mexican-side hotels (judgement) |
| 3 | Launch the [whitelabel](https://docs.nuitee.com/docs/whitelabel-booking-site) at `book.medsociety.one`. Reserve that name against the doctor-site wildcard. Link to it from hotel cards for matched hotels | A real refundable booking is made, cancelled and refunded |
| 4 | Compare bookings and support load with the CJ links over a few months | Evidence justifies custom work |
| 5 | Add a migration (check production's `schema_migrations` first): provider hotel ID on `hotels`, and a `bookings` table with RLS and no anonymous access | Throwaway-Postgres test passes |
| 6 | Add self-contained functions in `api/` for rates, prebook and book. Key stays server-side with no `VITE_` prefix. Cache searches to respect the look-to-book ratio | Self-test covers pricing and errors |
| 7 | Build the checkout: all-in total price first, cancellation policy, hotel rules, terms acceptance, English and Spanish. Prefer refundable rates by default | Reviewed by counsel |
| 8 | Prebook with `usePaymentSdk: true`, load Nuitee's payment script, and on return call book with the `TRANSACTION_ID` ([flow](https://docs.nuitee.com/docs/user-payment)) | Sandbox card 4242 4242 4242 4242 books once, even on page reload |
| 9 | Send confirmation, receipt and invoice; API users must do this themselves. Use the existing GHL e-mail path | Guest receives all three |
| 10 | Add cancellation, a daily reconciliation of bookings against Nuitee, a support contact and a refund runbook | Failed and abandoned payments handled |
| 11 | Switch to the live key behind a flag; keep "Check rates" as fallback | First live bookings reconciled |

Collect the minimum traveller data and keep it apart from inquiries and any health information. Hosted payment fields should keep card scope small, but the documents read do not state the PCI scope **(unverified)**.

#### Flights, only after hotels work

Start when flight clicks show real demand and California registration is in place. Open a Duffel account and test with `duffel_test_` tokens and the sandbox airline `ZZ` ([test mode](https://duffel.com/docs/api/overview/test-mode)). Confirm in writing that a company like MedSociety can get Managed Content, who is merchant of record, and which US carriers into San Diego and El Paso are bookable. Try Duffel Links before building search, passenger forms, payment, order management, schedule-change handling and refunds against the API. A single trip screen can then show the hotel and flight as two separate purchases with separate terms; do not price them as one package.

### Legal duties follow the selling and advertising

**California is the hurdle that cannot be avoided for a San Diego audience.** Its law reaches sellers who solicit people located in California, covers selling, arranging or advertising air travel, and requires registration at least 10 days before business, with the number on advertising ([statute](https://oag.ca.gov/sites/all/files/agweb/pdfs/travel/sot-statute-17550-59.pdf)). The statute copy lists $100 per location; other sources quote higher figures, so check the current fee. It also imposes pre-payment disclosures, refund deadlines, and a trust account or bond. The card carve-out applies where the carrier or service provider processes the charge, so an aggregator such as Nuitee or Duffel may not qualify. Companies outside California must tell buyers they are not in the state restitution fund. Penalties include criminal fines.

Hotel-only sales appear outside the California definition, which turns on transportation; confirm that with counsel. [Florida](https://www.fdacs.gov/Business-Services/Sellers-of-Travel/What-are-the-annual-fees-for-sellers-of-travel) charges $300 a year and reaches nonresidents. [Washington](https://app.leg.wa.gov/RCW/default.aspx?cite=19.138&full=true) covers out-of-state sellers that transact with its consumers and requires registration and trust or equivalent protection. [Hawaii](https://data.capitol.hawaii.gov/hrscurrent/Vol10_Ch0436-0474/HRS0468L/HRS_0468L-.htm) requires registration and a client trust account. Whether those three cover hotel-only sales is **(unverified)**, as is the absence of a Texas law.

On price display, the [FTC fee rule](https://www.ftc.gov/business-guidance/resources/rule-unfair-or-deceptive-fees-frequently-asked-questions) requires short-term lodging prices to show the total with mandatory fees most prominently. Air prices fall under the DOT full-fare rule, and a ticket agent that is merchant of record owes prompt refunds ([14 CFR 399.80](https://www.govinfo.gov/content/pkg/CFR-2025-title14-vol4/xml/CFR-2025-title14-vol4-sec399-80.xml)). A [July 2026 proposal](https://www.govinfo.gov/content/pkg/FR-2026-07-01/pdf/2026-13294.pdf) would loosen the display rule; its final status is **(unverified)**, so build to total-price-first. DOT says its 24-hour cancellation requirement does not bind third-party agents ([DOT](https://www.transportation.gov/individuals/aviation-consumer-protection/refunds), search summary), so state the real terms.

In Mexico, tourism providers, including those that contract services with tourists, face registry, price, invoice and refund duties ([Ley General de Turismo](https://www.diputados.gob.mx/LeyesBiblio/pdf/LGT.pdf)). The registry covers providers in the country; whether a US website without Mexican presence is covered is **(unverified)**. A reform published 13 November 2026 requires proof of relationship for minors before service, including electronically, so ask how the hotel or booking partner handles it.

**The medical side raises a separate risk: referral money.** [Texas](https://texas.public.law/statutes/tex._occ._code_section_102.001), [California](https://codes.findlaw.com/ca/business-and-professions-code/bpc-sect-650/) and [Florida](https://www.flsenate.gov/Laws/Statutes/2026/817.505) restrict paying or receiving money for steering patients. Their reach over Mexican-licensed providers is unclear, but US-side listings are exposed. Keep travel revenue independent of which provider a patient picks, charge no per-patient fee without healthcare counsel, and avoid a single "procedure plus hotel plus flight" price. A "Verified" badge that reads as endorsement matters here too (see ADR 0005).

Privacy law for combined health and travel data (HIPAA, California privacy statutes, Mexican data protection), occupancy and sales taxes, and liability insurance were **not researched**. Resolve all three before taking a booking.

### Conclusion

The useful line is not "affiliate versus API" but who carries the obligation when a patient's procedure moves. A hosted hotel checkout lets MedSociety learn that at low cost and can be switched off; air ticketing adds registration, schedule changes and refunds for little margin over Duffel's fees. "Book the whole trip here" is therefore best treated as one trip page that mixes an in-site hotel purchase with an outbound flight link, which delivers most of the convenience without waiting on flights.

The next actions are small: get the two affiliate approvals, run the LiteAPI coverage test, and send Nuitee and a travel lawyer the same questions. Those three results should decide whether any booking code gets written. Pages marked as search summaries, secondary sources, and the Travelpayouts help centre (which refuses automated reading) should be opened by a person before anyone relies on their wording.

## Flights: plan

Status: planned, not built. Last checked 23 Nov 2026. Every commission figure below comes from partner directories and the networks' own marketing pages, not from signed terms: treat them as ranges to confirm in each programme's dashboard after approval.

### Who flies, and where to

The same trip as the hotels, one step earlier. Four airports matter:

| Fly into | Then | Why a patient picks it |
|---|---|---|
| **San Diego (SAN)** | San Ysidro crossing, about 20 minutes by car | Most flights and fares; pairs with the US-side hotels |
| **Tijuana (TIJ)** | Already in Tijuana | Direct, no crossing. US travellers can also reach TIJ from the US side through Cross Border Xpress (a bridge from Otay Mesa), which is a transport product to research, not a flight |
| **El Paso (ELP)** | Paso del Norte, Bridge of the Americas or Ysleta–Zaragoza | Pairs with the El Paso hotels |
| **Ciudad Juárez (CJS)** | Already in Juárez | Few routes; mostly domestic Mexico |

Patients start anywhere in the US (and some in Mexico), so the origin is free, the destination is one of these four.

### What we would build (phased)

- **F1: a Flights tab on the homepage**, next to Doctors and Hotels. Origin airport, one of the four destinations (each with a one-line "what next" like the hotel crossing captions), dates, passengers. Search opens the partner's results in a new tab with our tracking. Nothing is stored. Same pattern as hotels: a link builder (`src/utils/flightLinks.ts`, with its own self-test) and `VITE_FLIGHT_AFFILIATE_LINK`, a template with one `{url}`, so any network works.
  *Built (not yet deployed):* `FlightSearchBox` on the homepage `?tab=flights`; `npm run flights:selftest`. Aviasales' link format is verified for round trip, one way, and the adults, children and infants digits. With no origin typed, the form asks; with no dates, it suggests leaving in two weeks and returning a week later.
- **F2: "how to get here" pages**, one per region and airport ("Flying into San Diego for care in Tijuana"): which airport, how to cross, what to bring, a link to hotels on each side. These are the pages search engines can rank; they also hold the disclosure.
  *Built (not yet deployed):* `/getting-here?region=…` (`GettingHerePage`, text in `src/utils/gettingHere.ts`, English copy prerendered in `api/agent.ts`, checked by `flights:selftest`), linked from the Hotels page. It has no booking links and no commission disclosure yet, because nothing on it earns; add the disclosure when a flight or transport link goes in. Rules (documents, FMM) are deliberately stated loosely and point to CBP and INM, since sources disagree; no prices or wait times.
- **F3: ground transport** between airport, border and clinic (Cross Border Xpress, shuttles, rideshare notes). Information first, partner links only where a programme exists.
  *Built, first pass (not yet deployed):* a "Getting around on the ground" section on `/getting-here` (airport to border by car, rideshare or transit with links to the operators, walking across, clinic or hotel pickup, Cross Border Xpress). No fares, times or partner links: the sources found were dated blogs and operator pages, so each item points to the operator. No ground-transport affiliate programme was identified; revisit if one is found (disclosure goes on the page then). Content still to check by someone local: current transit routes, pedestrian hours, and whether Uber and taxis can pick up at Tijuana and Juárez airports.
- **F4 (only if F1 earns real money): live fares.** A partner widget or API, so the page can show "from $X". This is where the privacy and terms work is, so it waits for evidence.
  *Built, switched off (not yet deployed):* `api/flight-fares.ts` asks Travelpayouts' cached `prices_for_dates` and `RecentFare` shows "Recently seen from $X" under the search. Needs `VITE_FLIGHT_FARES=on` and the server-only `TRAVELPAYOUTS_TOKEN`; without both nothing is shown or sent. The response fields come from public client code, not an official schema: check one real response after setting the token. Read the cautions under "Switch on what is already built" first.

On a clinic's page and in a hotel's page, a small "Getting here" line links to F2, the same way "Stay nearby" links to hotels.

### Which programme

Flights pay far less than hotels, usually 1% to 3% of the ticket, and some programmes pay nothing on flights. So flights are about completing the trip for the patient, not about revenue. Options, in the order to try:

| Programme | Reported terms | Notes |
|---|---|---|
| [Travelpayouts](https://www.travelpayouts.com/) (Aviasales and others) | Aviasales: about 1.1% of the ticket (half of Aviasales' 2.2%), 30-day cookie, last cookie wins, paid monthly, US$50 minimum ([Aviasales offer](https://travelpayouts.com/en/offers/aviasales-affiliate-program)) | One sign-up gives many programmes, including Kiwi.com. Simplest start. Check that Aviasales serves US visitors well |
| [Kiwi.com](https://www.travelpayouts.com/en/offers/kiwi-affiliate-program) | About 3% (2.8% to 3% in network listings), 30-day cookie | Through Travelpayouts, Awin or Webgains. Its flight API (Tequila) is now selective, so do not plan on it ([Kiwi.com](https://media.kiwi.com/articles-and-interviews/better-for-business-kiwi-com-takes-a-new-approach-to-partnerships/)) |
| [Skyscanner](https://www.partners.skyscanner.net/affiliates/affiliate-networks) | Sources disagree: from about 5% to 20% of Skyscanner's revenue, 30-day cookie ([overview](https://www.travelpayouts.com/blog/skyscanner-flight-affiliate-program/amp/)) | Applications are reviewed and want existing traffic, so apply once F1 has some. Conditions vary by country |
| [Expedia Group](https://partner.expediagroup.com/en-us/solutions/explore-our-affiliate-program) | 7-day window, last click ([Expedia help](https://help.creator.expediagroup.com/hc/en-us/articles/15187327581591-What-commission-will-I-earn)) | Flight commission is unclear: some sources say flights are not paid. Confirm in the dashboard before relying on it |

Recommendation: join Travelpayouts for F1, and add Skyscanner or Expedia when there is traffic to show them. Do not build on Kiwi's API.

### Steps to get paid (same shape as hotels)

1. Sign up with the network (Travelpayouts), with the same legal entity and tax form as the Booking.com account (see "Before applying").
2. Apply to the flight programme(s) from the list above.
3. Make one search link, put `{url}` in place of the destination, set `VITE_FLIGHT_AFFILIATE_LINK` in Vercel (Production and Preview) and redeploy.
4. Check on the live site that the link starts with the network's domain, carries `rel="sponsored"`, and the click shows in the network's report within a day.

### Rules

Same as hotels: no bidding on the partner's brand, no frames, keep "We may earn a commission when you book", and no fares of our own on our pages until F4. Flights add two more:
- Do not say a flight is "direct", "cheap" or "the fastest" ourselves. Only the partner's page can.
- No claim about border waits, crossing times or safety. Link to CBP's wait times, as the US-side hotel pages do.

### Decisions needed

- **Which partner first** (recommended: Travelpayouts).
- **Origin airports:** free entry with airport search, or a short list of big US cities (recommended: free entry).
- **Whether TIJ is offered** as a destination for US visitors, given they may need Cross Border Xpress. Recommended: yes, with that explained.
- **Spanish and Mexico-origin travellers:** show flights to Mexican visitors too (recommended: yes, same page).

### Record (fill in after approval)

| | |
|---|---|
| Network and publisher ID | |
| Approved on | |
| Commission | |
| Click window | |
| Template set in Vercel on | |
