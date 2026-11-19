# How travel sites get flight and hotel data

Background research for the medical-trip feature (V3). It explains how Booking.com, Expedia and Trip.com fill their pages, and what that means for MedSociety.

**Short answer:** mostly APIs. But the data passes through a few layers of middlemen first, and the biggest sites built direct connections years ago.

## Flights

The airline's own reservation system holds the inventory. That system is usually hosted by Amadeus Altéa, Sabre or Navitaire. Online travel agencies (OTAs) rarely talk to each airline one by one. They go through a **GDS (Global Distribution System)**:

- **Amadeus, Sabre and Travelport** are the big three. They pool fares and seat availability from hundreds of airlines and expose it through APIs, mostly SOAP/XML with some REST.
- **NDC (New Distribution Capability)** is the newer IATA standard. Airlines expose their own XML APIs directly, which lets them sell bundles, seat upgrades and dynamic prices. Expedia and Trip.com connect to major airlines through NDC as well as through the GDSs.
- **Aggregators and consolidators** like Duffel, Kiwi/Tequila and Travelfusion wrap all of this in a friendlier REST API. Smaller players use these because a direct GDS contract needs IATA accreditation or a host agency, certification and volume commitments.

Prices aren't stored and shown later. Each search hits these APIs live, with heavy caching, because fares change by the minute.

## Hotels

Here the big OTAs mostly use **direct connections**:

- A hotel runs a **PMS** (property management system) and usually a **channel manager** such as SiteMinder, Cloudbeds or RateGain. The channel manager pushes rates and room availability to Booking.com and Expedia through their **connectivity APIs**: Booking.com's Connectivity API and Expedia's EQC/Rapid partner APIs, often in the OTA XML standard.
- Hotels also self-onboard through extranets (Booking.com Extranet, Expedia Partner Central) and type in photos, descriptions and rates by hand.
- **Bedbanks / wholesalers** like Hotelbeds, WebBeds and Expedia's own Rapid API resell inventory to smaller sites. This is how a startup gets "millions of hotels" on day one.
- Chains like Marriott and Hilton connect through the GDSs too, or directly.

## Everything else

- **Reviews** are collected first-party from verified stays. That's why Booking.com only lets past guests review.
- **Static content** (photos, amenities, descriptions) comes from the hotel or from content providers, then gets cleaned up by hand.
- **Metasearch** sites (Google Hotels, Kayak, Skyscanner) don't sell anything. They query the OTAs' and suppliers' APIs and send you to the site where you actually book.

## What this means for MedSociety

Medical trips are planned for V3. When we get there, we shouldn't try to become an OTA. That would need IATA accreditation and supplier contracts, and we'd take on payment liability. Realistic options:

1. **Affiliate links or widgets.** Booking.com Affiliate Partner, Expedia's affiliate programme and Skyscanner/Kayak widgets. We earn a commission and carry no liability.
2. **A wrapper API.** Duffel for flights, Hotelbeds or Expedia Rapid for hotels, if we want booking inside the site. This needs a business agreement and they handle fulfilment.
3. **Curated partners.** Hand-picked hotels near the clinics in Tijuana and Juárez, linked or contacted directly. This probably fits the "medical trip" story better than a full search engine.

Current terms and requirements for each option still need checking when trips are scoped.
