# GHL workflows for paid plans

Two workflows in the MedSociety sub-account tell the site "something changed on
this contact". The site does the rest: it reads that contact's real payments from
GHL, switches the plan on or off, mirrors the tags and emails the team.

The workflow never says *what* was bought. Plan and market come from GHL's own
payment record (the payment link's name, e.g. "MedSociety Promoted US"), so there
is nothing to keep in step per product and nothing in the payload can grant a plan.

| | |
|---|---|
| Endpoint | `POST https://medsociety.one/api/billing` |
| Header | `x-webhook-secret: <BILLING_WEBHOOK_SECRET>` |
| Content-Type | `application/json` |
| Custom data | `event` = `sync`, `contact_id` = the contact's id (`{{contact.id}}`), `email` = `{{contact.email}}` |

GHL adds the standard contact fields to every webhook on its own.

## Workflow 1: "MedSociety Plan - payment received"

Prompt for GHL's AI workflow builder:

> Create a workflow named "MedSociety Plan - payment received".
> Trigger: Payment Received, for any product (no product filter).
> Actions, in order:
> 1. Wait 1 minute.
> 2. Webhook. Method POST. URL https://medsociety.one/api/billing.
>    Headers: `x-webhook-secret` = `<BILLING_WEBHOOK_SECRET>`, `Content-Type` = `application/json`.
>    Custom data (key = value): `event` = `sync`, `contact_id` = the contact's ID (merge field Contact ID), `email` = the contact's email (merge field Contact Email).
> 3. Wait 15 minutes.
> 4. Webhook, identical to step 2.
> Publish it.

The second webhook is a safety net in case GHL had not finished writing the
payment record after one minute. The site ignores anything it has already
applied, so sending twice is harmless.

## Workflow 2: "MedSociety Plan - tag changed"

> Create a workflow named "MedSociety Plan - tag changed".
> Triggers (any of): Contact Tag, tag added, tag `tier-promoted`; Contact Tag, tag added, tag `tier-featured`;
> Contact Tag, tag removed, tag `tier-promoted`; Contact Tag, tag removed, tag `tier-featured`.
> Actions: Webhook. Method POST. URL https://medsociety.one/api/billing.
> Headers: `x-webhook-secret` = `<BILLING_WEBHOOK_SECRET>`, `Content-Type` = `application/json`.
> Custom data (key = value): `event` = `sync`, `contact_id` = Contact ID, `email` = Contact Email.
> Publish it.

This catches every change to the plan tags, including ones made by an existing
workflow or by hand, without waiting for the daily sync.

It does not loop. When the site changes a tag it only does so after applying a
payment, and the ping that follows finds nothing new to apply.

## Optional: cancellations

If the account has a trigger for a subscription being cancelled, add it to
Workflow 1 as an extra trigger. If not, nothing is lost: the daily sync reads
cancellations from GHL, and a cancelled plan runs to the end of the paid month
either way.

## Rehearse with test payments, then go live

1. In Vercel add `BILLING_ACCEPT_TEST_MODE` = `1` and redeploy.
2. Sign in as a clinic owner, Dashboard > Plan > Subscribe, pay with a Stripe test card.
3. Within a minute or two: the Plan tab shows the plan, the contact gets the `tier-*` tag, the team gets an email, and the row appears in /admin > Billing.
4. **Remove `BILLING_ACCEPT_TEST_MODE` and redeploy.** While it is set, test charges grant real plans.
5. Switch GHL payments to live mode (Payments > Integrations > Stripe). Live-mode charges are picked up automatically.
