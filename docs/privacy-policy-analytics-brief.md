# Privacy policy: what to add for doctor analytics

For whoever edits the policy at `legal.medsociety.one/privacy-policy`. Written by the
developer, not a lawyer: the facts below are exact (they describe what the code does today),
but the legal conclusions are for you or counsel to confirm. Where I am unsure, it says so.

## The change in one paragraph

MedSociety now measures how people use provider profiles (who opened a profile, what part of
it they reached, whether they tapped call/WhatsApp, which results a search showed) and turns
that into **aggregate statistics shown to the doctor or clinic that owns the profile**, in their
dashboard and in report emails. Doctors never see who a visitor was. The measuring is done
with PostHog, a third-party analytics service we already used for general site analytics.

## Why the policy has to change

Three things are new, and a policy that only says "we use analytics to improve the site"
does not cover them:

1. **A new audience.** Data derived from visitors' behaviour is now handed to a third party,
   the clinic. Even aggregated, that is a disclosure the policy should name, and "we may share
   aggregated, de-identified statistics with the providers listed on the site" is the
   standard way to say it.
2. **A new purpose.** Until now analytics served MedSociety's own product decisions. Now it
   is also a feature we sell (the Promoted and Featured plans include these reports). Mexican
   privacy notices in particular are expected to list every purpose the data is used for.
3. **Search activity.** We now record *what kind of care* people search for (see below). That
   is not the text they type, but it is closer to health information than a page view is, so
   it deserves its own sentence.

## What is collected (exact)

Only when someone uses the site; nothing here is collected by asking them anything.

| Event | What is recorded |
|---|---|
| Profile viewed | Which listing; whether it opened as a pop-up or its own page; how they arrived (channel, below) |
| Result shown | Which listings a search put in front of them, and each one's position (top 20 only) |
| Result opened | Which listing, and its position in the list |
| Contact tapped | Which listing, and the kind of contact (call, WhatsApp, email, website, directions, social link). **Not** the phone number or message |
| Profile section reached | Which part of a profile came on screen (photos, reviews, message form, map…) |
| Search | See below |

Attached to every event: the UI language, device type (phone/computer), an approximate
country (derived from the IP address by PostHog), and **how the visit started**: one of
direct, search engine, AI assistant, social media, WhatsApp, email, ad, or other website, plus
the referring website's *domain only* (never the page or query string) and the campaign name
on links we send ourselves.

**Searches.** The text a person types is never sent anywhere. On their device it is checked
against a fixed list of about 40 *services* (for example "dental implants", "teeth whitening",
"massage", "LASIK"). Only the names of the services that matched are recorded, together with
which filters were in use (insurance, language, verified-only: yes or no), how many results
came back, and the specialty and region. The list contains services and procedures only, never
diagnoses, conditions or symptoms: that was a deliberate rule so the list cannot record
"depression" or "diabetes". It also leaves out anything in reproductive, sexual or mental
health (no fertility, contraception, prenatal care, vasectomy or therapy), which are the
searches most worth protecting if a record were ever tied to a person. For the AI "describe your problem" search, only the *specialty the
answer pointed to* is recorded, never the description.

**Who is identified.** A visitor who is not signed in is anonymous: PostHog stores a random
identifier in the browser (local storage and a cookie) and creates no profile. A signed-in
person is linked to their internal account id, **never their name, email or phone**, so a
signed-in person's activity is attached to a pseudonymous id in PostHog. The browser setting
"Do Not Track" is honoured (no events are sent). Session replay (screen recording) is **off**.

## What the doctor sees

Aggregate counts only, over the last 30 days: how many views, contacts (by type), where visitors
came from, which countries, devices and languages, the busiest hours, and how the profile
compares with similar ones. Safeguards built in:

- Nothing is shown until a profile has had enough visits (default 50 views and one week of data)
  so a small number cannot be traced to a person (a staff member's own visits, say). The
  clinic's own signed-in visits are excluded.
- Country, device and language breakdowns hide any group smaller than 3.
- The "what people search for" section shows services searched at least 3 times in the
  specialty and area, never an individual's search.
- A doctor never sees an identifiable visitor, a name, an email, or an individual's history.
- Patient *inquiries* (the message form) are a separate flow that already existed: the patient
  chooses to send their details to the clinic. They are not part of this analytics feature
  except that the clinic is told how many inquiries it received.

## Wording to add

Adapt freely. Short, plain-language versions of what each section should say.

**1. Analytics we run**
> We measure how people use MedSociety (for example which provider profiles are opened, which
> parts of a profile are viewed, and whether a phone, WhatsApp or website link is tapped) using
> PostHog, a service that processes this data on our behalf in the United States. We record the
> pages and actions, your approximate country, device type and language, and how you arrived
> at the site. If you sign in, these records are linked to an internal account number, not to
> your name, email or phone number. We do not record screens or keystrokes, and we honour your
> browser's Do Not Track setting.

**2. What we do with search activity**
> When you search, we do not store the words you type. We only note which general services
> your search mentioned from a fixed list (for example "dental implants"), the filters you used,
> and how many results appeared. We use this to understand what care people are looking for.

**3. Sharing statistics with providers**
> We share aggregated statistics about visits to a provider's own profile with that provider
> (for example how many people viewed it, how many contacted the clinic, and the general
> regions and devices of visitors). These statistics never identify you. We do not give
> providers your name, contact details or browsing history through this feature.

**4. Emails to providers** (only if the policy covers business contacts)
> Providers who manage a listing may receive periodic emails with these statistics, and can
> unsubscribe from them at any time.

**5. International transfers** (important for Mexican users)
> The services we use to process this information, including PostHog, store data in the United
> States. [Mexico: name PostHog as a data processor ("encargado") in the notice.]

## Mexico-specific points (confirm with counsel)

- The privacy notice should state the **purpose** "producing aggregated statistics for the
  providers listed on the site" and name **PostHog (US)** as a processor receiving the data.
- Health data is "sensitive personal data" and needs express consent. The design above is meant
  to avoid collecting it (no free text, no conditions, services only), but the search-activity
  paragraph is the one to run past counsel, because "this person looked for X service" tied to
  a signed-in id is the closest it gets.
- Mexico's federal data-protection law was replaced in 2025 and the regulator changed; please
  check the current notice requirements rather than relying on the older wording.

## US-specific points (confirm with counsel)

- California and similar state laws: describing the sharing as aggregated and de-identified, and
  not "selling" personal information, matters. The wording above supports that.
- Some states treat consumer health data (searching for care) specially. The same
  search-activity paragraph applies.
- The site honours Do Not Track but **not** Global Privacy Control signals today. If the policy
  promises to honour GPC, that would need a code change first; tell me and I will add it.

## Things I could not confirm from the code, to check in PostHog

- **Data retention** in the PostHog project (Settings → Data management). Name the real period
  in the policy.
- **IP address handling:** whether "Discard client IP data" is on. The country comes from the IP;
  if raw IPs are also stored, say so, or switch it on.
- **PostHog region:** the site's proxy points at the US cloud. If the project is EU-hosted, the
  transfer wording changes.

## If a visitor asks to be deleted

Anonymous visitors cannot be looked up (nothing links the random browser id to a person).
Signed-in people can be, by account id, in PostHog (person deletion). The statistics shown
to doctors are counts with no person attached, so deleting someone does not change them.
