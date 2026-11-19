# Paid plans through Stripe

Clinics pay for Promoted and Featured through Stripe. GoHighLevel is no longer
where money is taken; it stays the CRM (contact tags, notes and the website
set-up email), fed by the site after every change.

| | |
|---|---|
| Buy | Plan tab → **Subscribe** → Stripe Checkout (`POST /api/billing?job=stripe-checkout`) |
| Change, card, invoices, cancel | Plan tab → **Manage plan** → Stripe customer portal (`POST /api/billing?job=stripe-portal`) |
| Stripe → site | Webhook `POST /api/billing?job=stripe` |
| Backstop | Daily cron `GET /api/billing?job=sync` (09:00 UTC) also lists Stripe subscriptions |
| Database | `supabase/migrations/0053_stripe_billing.sql`, function `apply_stripe_event` |

## How it works

- **One Stripe customer per listing.** The listing id (`provider_id`) is set on
  the customer and on the subscription's metadata at checkout, so a payment is
  never matched to a listing by guessing an email.
- **The plan comes from the price.** Each price has a lookup key, and the code
  reads plan and market from it. Changing an amount in Stripe needs no code change.

  | Plan | USD | MXN |
  |---|---|---|
  | Promoted | `promoted_us_monthly` ($49) | `promoted_mx_monthly` ($899) |
  | Featured | `featured_us_monthly` ($99) | `featured_mx_monthly` ($1,799) |

- **`paid_through` is Stripe's period end**, not "now + 1 month".
- **Upgrades** are charged at once for the days left (proration) and switch the
  plan when that invoice is paid. **Downgrades and cancellations** take effect at
  the end of the period. A cancelled plan keeps access until `paid_through`, with
  no grace period (`0052`).
- **One live plan per subscription.** When a payment for another plan arrives on
  the same subscription, the old plan's row ends.
- **Webhook authenticity.** The endpoint reads only the event id from the request
  and fetches that event from Stripe with the secret key, then acts on what Stripe
  returns. No signing secret is used. Events from the other mode (test vs live)
  than the key are ignored.
- A listing that already pays cannot start a second checkout (`409
  already_subscribed`); it uses the portal. Stripe is asked too, so a plan that
  lapsed in our records while Stripe still retries its last charge also counts.
- **Owners only.** Checkout and the portal need the `owner` role on the listing;
  staff (front desk) cannot buy, switch, cancel or see invoices.
- A Stripe customer id stored for a listing that the current key cannot see (a
  test id from a preview, or a deleted customer) is ignored.
- Subscription changes are applied from the subscription as Stripe has it now,
  not from the event's snapshot, so late or out-of-order events cannot undo a
  newer change. The daily run also puts back a cancel that was undone.
- **Refunds** are flagged in /admin and never end a plan by themselves. To end a
  plan now, use **End plan now** in /admin → Billing.

## Setup (once per mode: test, then live)

1. **Products and prices.** Product *MedSociety Promoted* with the two Promoted
   prices, product *MedSociety Featured* with the two Featured prices. Monthly,
   recurring, flat rate, **one price per currency** (do not use "add currency" on
   a single price), each with its lookup key from the table above.
2. **Customer portal** (Settings → Billing → Customer portal):
   - Payment methods: on. Invoice history: on.
   - Cancellations: on, **at the end of the billing period**. Survey optional;
     no retention coupons or offers (cancelling must not take extra steps: LFPC
     art. 76 Bis, California ARL).
   - Switch plans: on, both products with both prices. Changes that increase
     cost: **apply immediately**, **prorate charges and credits, invoice
     immediately**. Changes that decrease cost: **at the end of the billing period**.
     Change quantities: off.
   - Business information: name **MedSociety**, real terms and privacy URLs,
     redirect link left blank (the site sets it per session).
3. **Branding**: logo, icon and colour (shown on Checkout, the portal and receipts).
4. **Webhook** (Workbench → Webhooks → Add destination): events from *your
   account*, payload *snapshot*, events `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `charge.refunded`.
   - Live: `https://www.medsociety.one/api/billing?job=stripe`
   - Preview: the branch URL plus `&x-vercel-protection-bypass=<secret>` (Vercel
     → Settings → Deployment Protection → Protection Bypass for Automation).
5. **Vercel environment variables**

   | Name | Production | Preview |
   |---|---|---|
   | `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` |
   | `STRIPE_PORTAL_CONFIG` | optional `bpc_…` | optional |
   | `SUPABASE_SERVICE_ROLE_KEY` | already set | needed to test previews |
   | `GHL_PIT_MEDSOCIETY`, `GHL_LOCATION_MEDSOCIETY` | already set | optional (CRM mirror on previews) |
   | `VERCEL_TOKEN` | already set | **never** (it turns on website autocreate) |

   Without `STRIPE_SECRET_KEY` the Stripe routes answer `not_configured` and log
   it, and the daily cron skips Stripe.

Previews share the production database. Test purchases on a preview change real
listings: use a test listing and end the plan afterwards.

## Going live (order matters)

1. Live mode: steps 1–4 above.
2. Vercel Production: `STRIPE_SECRET_KEY` = the live key.
3. Clear the test-mode ids that preview tests left on real listings, so "Manage
   plan" is not offered for a sandbox customer (Supabase SQL editor):
   `update provider_subscriptions set stripe_customer_id = null, stripe_subscription_id = null, stripe_price_id = null where stripe_customer_id is not null and status not in ('active', 'canceled');`
   Check first that no live (`sk_live_`) purchase has happened yet.
4. Merge the pull request. From the next deploy, Subscribe opens Stripe.
5. Check: buy Promoted on a test listing with a real card, see the plan switch
   on, cancel in the portal, refund in Stripe, **End plan now** in /admin.
6. GHL: turn off the workflows that report payments (*MedSociety Plan - payment
   received*, *MedSociety Plan - tag changed*). Archive the old GHL-made products
   in Stripe ("… US", "… MX") once nothing bills on them.
7. Later clean-up (separate change): remove the GHL payment webhook and polling
   from `api/billing.ts`, then drop `plan_checkouts` and `start_plan_checkout`.
   They must go in that order: the GHL matching function reads `plan_checkouts`.

**Rollback:** revert the merge. The database changes are additive (new columns
and a new function; the GHL path is untouched), so the previous code runs as
before against the same database.

## Tested on a preview (Nov 19, 2026, Stripe sandbox)

Subscribe (Promoted, $49), upgrade to Featured ($49.70 prorated, renewal date
kept), cancel at period end, undo the cancel, GHL mirror, End plan now. Covered
by self-tests only: downgrade at renewal, failed renewal, refund
(`npx tsx scripts/billing-selftest.ts`).

## Known limits

- **End plan now** in /admin ends the plan in our records only. Cancel the
  subscription in Stripe too, or the next renewal charge switches it back on.
- Attaching an unmatched Stripe payment to a listing in /admin uses the older
  GHL logic (paid through now + 1 month, no Stripe ids). Rare: Stripe payments
  carry the listing id. Prefer fixing the subscription's `provider_id` metadata in
  Stripe and resending the event.
- A Stripe payment on a listing that has a **comp** row for the same plan turns
  the comp into a paid plan, so it ends when the subscription does.
- The daily cross-check can announce a cancel the webhook already announced.
- The webhook endpoint is public by design; each call costs one Stripe API read.

## Still to do

- Renewal reminder e-mail before each renewal (Mexico asks for at least 5 days'
  notice; Stripe's own upcoming-renewal e-mails can do this).
- Cancellation confirmation e-mail (Stripe can send it).
