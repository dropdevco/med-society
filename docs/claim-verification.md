# Claim verification: how we decide who owns a listing

Owning a listing means editing what patients read about a doctor and receiving their messages. A wrong approval hands that to an impostor, so every claim is reviewed by a person in **/admin → Claims**. Nothing is granted automatically (migration `0047_claim_verification.sql`).

## What the claimant sends

| Role | Always | Plus |
|---|---|---|
| Doctor, Mexican listing | Legal name, phone, government photo ID | Cédula profesional number + photo of the cédula or the SEP constancia |
| Doctor, US listing | same | NPI (checksum-validated) + state licence number and state + licence document |
| Clinic owner / legal representative | same | Business document in the clinic's name (constancia de situación fiscal, COFEPRIS aviso / licencia sanitaria, business licence); RFC optional |
| Authorised staff | same | Letter signed by the doctor or owner. Approval grants **staff**, not owner |

Documents live in the private `claim-documents` bucket. Only app admins can open them, through five-minute links in the Claims tab. Never download them to shared drives or forward them by email.

## The three checks (the database refuses an approval without them)

1. **The ID is genuine and shows the legal name.** Compare it with the name on the cédula, licence or business document.
2. **The credential is real.**
   - Cédula: search the name at [SEP](https://www.cedulaprofesional.sep.gob.mx/cedula/presidencia/indexAvanzada.action). The number, the name and a medical degree must match.
   - NPI: open the NPPES link in the claim. The name, the specialty and the state must match.
   - Licence: the state board link in the claim (TX, CA, NM, AZ).
   - Business: the document is in the clinic's name and the address matches the listing.
3. **The clinic confirms it.** Call or WhatsApp the phone **already on the listing**, or write to the email already on it. Never use a number the claimant gave you for this. Ask for the person by name.

Why the third check matters: cédulas are public. Anyone can look up a doctor's cédula on SEP and photograph a borrowed ID. Only the clinic's own line ties the person to this listing.

If the listing has no phone or email, or the number is dead, you may approve without check 3. You must then write an internal note (at least 20 characters) saying what you did instead, for example a video call with the doctor holding their cédula, or the clinic's website listing the claimant.

## Signals the queue shows

The database computes these when a claim is submitted, and again when you open it. They are hints, not proof.

- **Strong:** the account email equals the listing email. The account email is on the clinic website's own domain (not Gmail or Hotmail).
- **Useful:** the phone given equals the listing phone. The cédula matches our identity registry for this listing's doctor.
- **Red flags:** the cédula belongs to a *different* doctor in our registry. The listing already has an owner. Several people are claiming the same listing. The account has other claims or earlier rejections. The account is less than a day old. The legal name does not resemble the listing's doctor.

## Decisions

- **Approve:** needs all three checks, or checks 1 and 2 plus a written reason for skipping check 3. The claimant becomes owner (staff, for an authorised manager).
- **Ask for more:** write what you need (for example "a clearer photo of your INE" or "we could not reach the clinic at 656…; when can we call?"). The claimant sees your message on /dashboard and /claim and answers there. Only a claim back in *To review* can be approved.
- **Reject:** write the reason; the claimant reads it. They can submit a new claim after 30 days.

If a listing already has an owner, approving a second claim adds a co-owner. Contact the existing owner first.

## Not built yet

- The claimant gets no email when you decide. They see the result on /dashboard. Claim alerts reach the team through the leads table and its webhook, so check that path is delivering.
- Documents are not deleted automatically. Decide on a retention period (for example 90 days after the decision), and confirm the privacy notice covers ID documents (LFPDPPP) before this goes live.
- Nothing calls SEP or NPPES automatically. The reviewer checks by hand.
