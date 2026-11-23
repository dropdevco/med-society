# Hotels

The first piece of the medical-trip pipeline: patients who travel to Tijuana or Ciudad Juárez for treatment can find a place to stay near their doctor. Background research on how travel sites get hotel data is in [travel-booking-data.md](travel-booking-data.md). Getting paid for bookings is in [booking-affiliate.md](booking-affiliate.md).

## How it works

- **Found near the clinics, then curated.** `scripts/hotels/find.ts` finds hotels through Google Places around the densest clusters of our own listings and publishes them (below). An admin can also add, edit or hide any hotel by hand in **Admin → Hotels** (`/admin?tab=hotels`). Nothing is scraped, and Booking.com is never read ([ADR 0002](adr/0002-source-access-policy.md); the register entry is in [sources/README.md](sources/README.md)).
- **Booking is off-site.** "Check rates" opens Booking.com, with the patient's dates and our affiliate link added by `bookingHref` in [`src/utils/hotelLinks.ts`](../src/utils/hotelLinks.ts). MedSociety takes no payments and holds no reservations. A hotel with no Booking.com link can link to its own website instead, with no commission.
- **Separate from providers.** Hotels live in `public.hotels` (migrations [0054](../supabase/migrations/0054_hotels.sql) and [0056](../supabase/migrations/0056_hotels_google.sql)), so they never reach search, leads, claims, provider analytics or `provider_list`. Recovery houses are different: they offer care, so they stay in `providers` with `kind = 'stay'` ([recovery-centers-plan.md](recovery-centers-plan.md)).

## Where patients see hotels

| Place | What | Code |
|---|---|---|
| Homepage, above the search box | Tabs, "Doctors & clinics" and "Hotels", like Expedia's. Hotels takes a city and optional dates and opens `/hotels`. `/?tab=hotels` opens on it | `src/components/search/VerticalTabs.tsx`, `src/components/hotels/HotelSearchBox.tsx` |
| Homepage, after the first row | "Hotels near the clinics in {city}", up to 10 cards. Hidden when the region has none | `src/components/hotels/HotelRow.tsx` |
| A provider's page or modal, Mexican side only | "Stay nearby": the 3 closest published hotels within 8 km, with distances | `src/components/hotels/StayNearby.tsx`, `hotels_near()` RPC |
| `/hotels?region=…` | Every published hotel in the region's Mexican city, with dates, filters and a map. `&near=<providerId>` sorts by distance from that provider. `&checkin=&checkout=` (YYYY-MM-DD) carry the stay to Booking.com; past or impossible dates are dropped | `src/pages/HotelsPage.tsx` |
| Crawlers and agents | The same list as server HTML, Markdown or JSON, with `Hotel` JSON-LD, and listed in the sitemap and `llms.txt` | `hotelsPage()` in `api/agent.ts` |

The nav has a "Hotels" link (hidden under 480px). Every list shows the line "We may earn a commission when you book". Affiliate links carry `rel="sponsored"`.

Cards show the hotel's own photo when an admin set one, else its Google cover photo through `/api/place-photo` (nothing stored; the proxy only serves place IDs of providers and published hotels), else a monogram. Ratings are Google's, with the review count.

## Finding hotels (Google Places)

```bash
npx tsx scripts/hotels/find.ts                 # dry run: prints the picks, writes nothing
npx tsx scripts/hotels/find.ts --commit        # publishes them (status live)
npx tsx scripts/hotels/find.ts --city=juarez --per-city=15
```

1. **Centres:** the 5 densest 1-km cells of live Mexican listings in each city, at least 1.5 km apart, read from `providers`.
2. **Search:** around each centre, a Google text search for "hotel" and a nearby search for lodging, 3 km.
3. **Filters:**
   - Mexican side only (the Tijuana survey line and US-address checks from the provider sweeps; Place Details confirms country MX).
   - No motels, auto hotels or hostels. In Mexico these are often hourly rooms.
   - Closed places are dropped, and so is anything under 4.0 stars or 100 reviews.
4. **Ranking:** closeness to listings, then rating × log(reviews), with no more than half from one Google price level. 12 per city by default.
5. **Each row gets:**
   - name, address, coordinates, phone and website
   - Google rating and review count
   - `google_place_id`
   - a Booking.com search link for the hotel's name and city
   - a factual description from our own data ("120 doctors and clinics listed within 1 km. The nearest is 600 m away."), in EN and ES
   - no amenities: only an admin adds those, from what the hotel states

Re-running updates the same rows by place ID. It never un-hides a hotel an admin hid, and never overwrites the description of a hand-made hotel.

Each run has a UUIDv7 run ID, stored on the rows it writes (`source_run_id`) and in its run file under `scripts/hotels/.data/` (git-ignored, with a cache of Google's responses so a dry run and the commit after it are billed once). A run of both cities is about 50 searches and 25 Place Details calls, under US$2 at list price.

Google's terms let us keep only the place ID indefinitely. Like providers, the row also keeps name, address, coordinates and rating. Re-run the finder from time to time to refresh them, and remove what Google no longer lists.

## The US side (San Diego, El Paso)

Some patients would rather not sleep in Mexico and cross for the day. So each region also has hotels on the US side, with `country = 'US'` (migration 0059; `region` still comes from longitude, so San Diego sits in `sandiego-tijuana` and El Paso in `elpaso-juarez`).

- **Where they show.** `/hotels?region=…&side=us` (a second toggle under the city buttons), a second homepage row ("Stay in San Diego, cross for your appointment"), the Hotels tab's search box ("San Diego (cross to Tijuana)"), and a smaller group on a Mexican provider's page when a border crossing is within 30 km of the clinic. Every list asks for one country, so the two sides never mix.
- **How they are found.** `npx tsx scripts/hotels/find.ts --city=sandiego` or `--city=elpaso` (dry run by default). The search is centred a few km into the US from each crossing (a search at the line itself fills with Mexican hotels), within 6 km. Place Details must say the country is US. Ranking is by distance to the nearest crossing, then rating × log(reviews); the same filters apply (4.0 stars, 100 reviews, no motels or campgrounds). Default 8 per city. The row's `city` is Google's locality (Chula Vista, San Ysidro), so the Booking.com search is right.
- **What a US tile says.** The photo, the name, and one line: the straight-line distance to the nearest crossing ("1.3 mi to San Ysidro" in English, "A 2.1 km de San Ysidro" in Spanish). Never a travel time, never a claim about waits or safety; the page links to CBP's border wait times instead.
- **Crossings.** The list lives in `src/utils/borderCrossings.ts`, with a copy in `api/agent.ts` (it cannot import from `src/`); `scripts/agent-selftest.ts` checks they match. The coordinates are approximate, the pedestrian entrance to a few hundred metres.
- **Admin.** Admin → Hotels has a "Side of the border" choice, so a hand-added US hotel stays US.
- **Ship order.** Apply 0059, deploy, then run the finder with `--commit`. The finder never changes the status of a hotel an admin has hidden or kept as a draft.

## Adding a hotel by hand

1. **Admin → Hotels → Add a hotel.**
2. **Coordinates:** paste `lat, lng`, or a Google Maps link to the hotel. The form reads the pin (`!3d…!4d…`) over the map's view (`@…`) and shows which region it falls in.
3. **Booking.com link:** the hotel's page URL with no tracking parameters (`https://www.booking.com/hotel/mx/<name>.html`), or a Booking.com search for it. We add the dates, `lang`, `label` and the affiliate link ourselves.
4. **Amenities:** only what the hotel itself states. "Nurse on call" and "Clinic shuttle" are promises to patients, so leave them unticked if in doubt.
5. **Photo:** an `https` URL we have the right to use (the hotel's press kit, or one they sent). Leave it empty rather than hotlinking a Booking.com image.
6. Save as a **draft**. It goes public only when you click **Publish**. **Hide** takes it down again.

The database enforces this. Visitors and non-admins only ever read `status = 'live'` rows, and every write needs `is_app_admin()`. The form can't widen that.

### Amenities

| Key | Means |
|---|---|
| `clinic_shuttle` | The hotel drives guests to clinics or hospitals |
| `airport_shuttle` | Shuttle to TIJ / CJS, or across to SAN / ELP |
| `border_shuttle` | Shuttle to a border crossing (San Ysidro, Otay, Paso del Norte…) |
| `accessible` | Step-free rooms or wheelchair access |
| `kitchenette` | In-room kitchen, for longer recoveries |
| `quiet_recovery` | Rooms suited to rest after a procedure: quiet, blackout, room service |
| `nurse_on_call` | A nurse is available on site or on call |
| `bilingual_staff` | The front desk speaks English |
| `parking` | On-site parking |

The list is closed: it is checked in the migration and listed in `HOTEL_AMENITIES` (`src/types/hotel.ts`), `AMENITY_LABEL` in the admin panel, the `hotels.amenity.*` i18n keys and `HOTEL_AMENITY_NAMES` in `api/agent.ts`. To add a value, change all five.

## Analytics

These go to PostHog (`src/lib/posthog.ts`):

- `hotel_impression`: one per provider page that showed hotels, one per region view of `/hotels`, and one per region the homepage row is shown for. Props: `surface` (`provider_page`, `hotels_page`, `home`), `region`, `side` (`mx` or `us`), `count`, `provider_id`. The homepage and provider page send one per side.
- `hotel_outbound_click`: one per "Check rates" click. Props: `hotel_id`, `hotel_name`, `region`, `surface`, `side`, `affiliate`, `dated`, `provider_id`, `distance_km`; for US hotels also `crossing_id` and `crossing_km`.
- `home_tab_selected`: the homepage tab a visitor switched to (`care` or `hotels`).
- `search_performed` with `vertical: 'hotels'`: a search from the homepage Hotels tab.

Together these show which doctors send patients to hotels, which is the number to reconcile against Booking.com's commission reports.

## Checks

```bash
npm run hotels:selftest                 # links, affiliate template, dates, the finder's rules
bash supabase/tests/hotels/run.sh       # 0054 + 0056 in a throwaway Postgres (Docker)
npx tsx scripts/agent-selftest.ts       # the server-rendered /hotels page
```

## Later

- A trip planner: doctor, dates, hotel and transport saved together and handed off on WhatsApp.
- Recovery houses (`providers.kind = 'stay'`) shown beside hotels under "Where to stay".
- Hotel claims and featured placement through the claim and GHL billing flow.
- Live rates or in-site booking (Hotelbeds, Expedia Rapid), which needs contracts and payments.
