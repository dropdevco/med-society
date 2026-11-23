# Travel affiliate programmes: hotels and flights

How MedSociety gets paid when a patient books part of their trip through a partner, and the plan for each part. **Hotels** (Booking.com through CJ) are built and waiting for an affiliate link; **flights** are planned below and not built yet. In both we only send the visitor out to the partner: no booking, no payment, no prices of our own on our pages.

The rest of this page is the Booking.com (hotels) sign-up, step by step. Until it is done, "Check rates" works but earns nothing. The code is ready: when the steps are done, turning commission on is one environment variable and a redeploy. The flights plan is at the end, under [Flights](#flights-plan).

Last checked 19 Nov 2026. Booking.com changes this programme often, so re-check step 2 before starting.

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
  *Built (not yet deployed):* `FlightSearchBox` on the homepage `?tab=flights`; `npm run flights:selftest`. Aviasales' link format is verified for round trip, one way and the adults digit; children and infants are not offered. With no origin typed, the form asks; with no dates, it suggests leaving in two weeks and returning a week later.
- **F2: "how to get here" pages**, one per region and airport ("Flying into San Diego for care in Tijuana"): which airport, how to cross, what to bring, a link to hotels on each side. These are the pages search engines can rank; they also hold the disclosure.
  *Built (not yet deployed):* `/getting-here?region=…` (`GettingHerePage`, text in `src/utils/gettingHere.ts`, English copy prerendered in `api/agent.ts`, checked by `flights:selftest`), linked from the Hotels page. It has no booking links and no commission disclosure yet, because nothing on it earns; add the disclosure when a flight or transport link goes in. Rules (documents, FMM) are deliberately stated loosely and point to CBP and INM, since sources disagree; no prices or wait times.
- **F3: ground transport** between airport, border and clinic (Cross Border Xpress, shuttles, rideshare notes). Information first, partner links only where a programme exists.
- **F4 (only if F1 earns real money): live fares.** A partner widget or API, so the page can show "from $X". This is where the privacy and terms work is, so it waits for evidence.

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
