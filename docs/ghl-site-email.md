# The "set up your website" email (handoff for Isaac, GHL)

A clinic on the US$99 plan gets a website at `<name>.medsociety.one`. The site is only as good as
the brief the owner gives us (see "The brief" in `doctor-sites.md`), so the whole job of this email
is to get the owner to fill in the **Website** tab of their dashboard. This note says what the email
has to do, what GHL needs to know, and the open questions.

## What the email must do

1. Tell the owner their website is ready to set up, in their language.
2. Send them to one link: `https://www.medsociety.one/dashboard?tab=website`
   (opens the Website tab; if they are signed out they sign in first and land there).
3. Set the expectation: about 10 minutes, photos from their phone are fine, nothing is published
   until they approve the text and our team has looked at the site.
4. Follow up if they do nothing.

## When it should be sent

**Not on payment.** The site does not exist the moment a plan is bought: today a person creates the
`doctor_sites` row and adds the subdomain in Vercel (automatic creation needs a Vercel token we do
not have yet). The dashboard tab only appears once that row exists, so an email sent on payment
would send the owner to a page with no Website tab.

So the trigger is a **tag added to the contact**, in this order:

| Step | What happens | Who |
|---|---|---|
| 1 | Plan is paid (`tier-featured` tag, already set by `api/billing.ts`) | automatic |
| 2 | We create the site (row + subdomain) | us, by hand for now |
| 3 | We add the tag **`site-brief-invite`** to the GHL contact | us for now; automatic once site creation is automatic |
| 4 | GHL workflow "Trigger: Contact Tag added = `site-brief-invite`" sends email 1 | GHL |

Isaac: please build the workflow on the tag, not on payment. When site creation becomes automatic
we will add the tag from code, the same way billing already adds `tier-featured`, and nothing in GHL
changes.

## Sequence

- **Email 1, immediately:** "Your website is ready to set up" (draft below).
- **Email 2, +3 days:** short reminder, same link.
- **Email 3, +7 days:** reminder that offers help ("reply to this email and we will do it with you").
- **Stop** the sequence when the owner has finished. We do not report that back to GHL yet. Until we
  do, stop it by hand, or by a GHL condition if you have one. We can add a tag `site-brief-done`
  from code when the brief is saved; say if you want that and we will build it.

## Merge fields and links

- Contact first name and clinic name from the GHL contact (already there from the claim).
- Link: always the one URL above. Do not put the owner's email or any ID in the link.
- Language: use the same language rule as the payment links (Spanish for the Mexico market, English
  for the US market). Tag `medsociety-market-mx` / `medsociety-market-us` already exist.

## Draft copy

**ES.** Asunto: *Tu sitio web de {{clinic}} está listo para armarse*

> Hola {{first_name}},
>
> Ya reservamos tu sitio web: **{{subdomain}}.medsociety.one**. Para que quede como tú quieres,
> necesitamos conocerte un poco: qué es lo más importante para ti, tus colores, tus fotos y unas
> líneas sobre tu consulta.
>
> Toma unos 10 minutos y puedes subir las fotos desde tu celular. Con tus respuestas escribimos el
> texto, y tú lo revisas y lo apruebas. Nada se publica sin tu visto bueno.
>
> **Armar mi sitio:** https://www.medsociety.one/dashboard?tab=website
>
> Si prefieres hacerlo acompañado, responde este correo y lo hacemos juntos.

**EN.** Subject: *Your {{clinic}} website is ready to set up*

> Hi {{first_name}},
>
> We have reserved your website: **{{subdomain}}.medsociety.one**. To make it yours, we need to know
> a little about you: what matters most to you, your colours, your photos and a few lines about your
> practice.
>
> It takes about 10 minutes and you can upload photos from your phone. We write the text from your
> answers, and you read and approve it. Nothing goes public without your approval.
>
> **Set up my website:** https://www.medsociety.one/dashboard?tab=website
>
> If you would rather do it together, reply to this email and we will do it with you.

`{{subdomain}}` is only known to us. Until the tag is added from code, put it in a GHL custom field on
the contact (`site_subdomain`) when we add the tag, or drop that sentence from the template.

## Open questions (need an answer before this goes live)

1. **Does every paying owner already have a MedSociety account that owns the listing?** The Website
   tab is only visible to a signed-in user who owns that listing (the claim flow). A clinic that paid
   through the payment link but never claimed has nothing to sign in to. What does the GHL payment
   flow do today to make sure they have claimed? If it does nothing, the email needs a first step
   ("claim your listing") and we should decide who does it.
2. **From which sender and domain** does the email go? Replies should reach a person.
3. **Reminder timing and stop condition**: is +3 and +7 days right, and do you want the
   `site-brief-done` tag from code?
4. **Anything else GHL needs from us** to build it: a test contact, the tag created, the custom
   field. Tell us and we will set it up.

## What the site never does without the owner

The AI draft of the text is shown to the owner only when they press the button in the dashboard,
and nothing reaches the site until they press Approve. The email must not promise that the site
"is already live": it is a private preview until the team publishes it.
