# Hotels

The first piece of the medical-trip pipeline: patients who travel to Tijuana or Ciudad Juárez for treatment can find a place to stay near their doctor. Background research on how travel sites get hotel data is in [travel-booking-data.md](travel-booking-data.md).

## How it works

- **Curated, not imported.** An admin adds each hotel by hand in **Admin → Hotels** (`/admin?tab=hotels`). Nothing is scraped. The details come from the hotel's own site and its Booking.com page, typed in by a person ([ADR 0002](adr/0002-source-access-policy.md)).
- **Booking is off-site.** "Check rates" opens the hotel's Booking.com page, with our affiliate id added by `bookingHref` in [`src/utils/hotelLinks.ts`](../src/utils/hotelLinks.ts). MedSociety takes no payments and holds no reservations. A hotel with no Booking.com page can link to its own website instead, with no commission.
- **Separate from providers.** Hotels live in `public.hotels` ([migration 0054](../supabase/migrations/0054_hotels.sql)), so they never reach search, leads, claims, provider analytics or `provider_list`. Recovery houses are different: they offer care, so they stay in `providers` with `kind = 'stay'` ([recovery-centers-plan.md](recovery-centers-plan.md)).

## Where patients see hotels

| Place | What | Code |
|---|---|---|
| A provider's page or modal, Mexican side only | "Stay nearby": the 3 closest published hotels within 8 km, with distances | `src/components/hotels/StayNearby.tsx`, `hotels_near()` RPC |
| `/hotels?region=…` | Every published hotel in the region's Mexican city, with price and amenity filters and a map. `&near=<providerId>` sorts by distance from that provider | `src/pages/HotelsPage.tsx` |
| Crawlers and agents | The same list as server HTML, Markdown or JSON, with `Hotel` JSON-LD, and listed in the sitemap and `llms.txt` | `hotelsPage()` in `api/agent.ts` |

The nav has a "Hotels" link. Every list shows the line "We may earn a commission when you book". Affiliate links carry `rel="sponsored"`.

## Adding a hotel

1. **Admin → Hotels → Add a hotel.**
2. **Coordinates:** paste `lat, lng`, or a Google Maps link to the hotel. The form reads the pin (`!3d…!4d…`) over the map's view (`@…`) and shows which region it falls in.
3. **Booking.com link:** the hotel's page URL with no tracking parameters (`https://www.booking.com/hotel/mx/<name>.html`). We add `aid`, `lang` and `label` ourselves.
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

- `hotel_impression`: one per provider page that showed hotels, and one per region view of `/hotels`. Props: `surface`, `region`, `count`, `provider_id`.
- `hotel_outbound_click`: one per "Check rates" click. Props: `hotel_id`, `hotel_name`, `region`, `surface`, `affiliate`, `provider_id`, `distance_km`.

Together these show which doctors send patients to hotels, which is the number to reconcile against Booking.com's commission reports.

## Setup checklist

- [ ] Apply `supabase/migrations/0054_hotels.sql` to production by hand. 0050–0053 are already there. Test it first with `bash supabase/tests/hotels/run.sh`, which needs Docker.
- [ ] Join the [Booking.com Affiliate Partner Programme](https://www.booking.com/affiliate-program/v2/index.html), then set `VITE_BOOKING_AFFILIATE_ID` in Vercel (Production and Preview). Until then, links work without commission.
- [ ] Seed 8–12 hotels per city near the clinic clusters: Zona Río, Hipódromo and Zona Urbana Río in Tijuana, and the hospital corridor around Av. Tecnológico and Paseo Triunfo de la República in Juárez.

## Later

- A trip planner: doctor, dates, hotel and transport saved together and handed off on WhatsApp.
- Recovery houses (`providers.kind = 'stay'`) shown beside hotels under "Where to stay".
- Hotel claims and featured placement through the claim and GHL billing flow.
- Live rates or in-site booking (Hotelbeds, Expedia Rapid), which needs contracts and payments.
