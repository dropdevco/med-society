# Getting our Booking.com affiliate link

How to get paid when a patient books a hotel from MedSociety. Until this is done, "Check rates" works but earns nothing. The code is ready: when the steps below are done, turning commission on is one environment variable and a redeploy.

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
