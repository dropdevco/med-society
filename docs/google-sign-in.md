# Google sign-in: plan

Status: planned, not started (2026-11-23).

Adding "Continue with Google" needs **no database migration**. Every identity check in the schema uses
`auth.uid()`, `lower(auth.users.email)` and `email_confirmed_at`. A Google account arrives with a verified
email, so it already passes all of them. The work is Google and Supabase setup, one new auth function,
buttons on two sign-in screens, and a few safety fixes.

## How it fits what exists

| Area | What happens with a Google user |
|---|---|
| Same email as an existing password account | Supabase links the Google identity to the existing user, so `user.id` does not change. `provider_owners`, team membership, claims and inquiries stay attached. |
| Claims (0047, 0048) | Still human-reviewed. `email_matches_listing` is still only evidence; a Google email counts as confirmed. No change. |
| Invites (0020b, 0049) | `accept_invite` compares the invited email with the account email. A different Gmail gets the existing "wrong account" screen in `src/pages/InvitePage.tsx`. |
| Admins (0026) | `app_admins` matches by email plus confirmed status. An admin can use Google if their listed email is their Google address. |
| `api/inquiry.ts`, `api/agent.ts` site routes | Tokens are checked against `/auth/v1/user`, which works the same for Google. The "unconfirmed" 401 never fires for these users. |
| Patient inquiries | `src/components/provider/InquiryForm.tsx` already reads `full_name` / `name` from `user_metadata`, which Google fills in. The draft is in localStorage, so it survives the redirect to Google and back. |
| Forum notifications, lead e-mails | They filter on `email_confirmed_at is not null`, so Google users are included. |

## Phase 0: setup (done by hand, keys never in git)

1. **Google Cloud Console**
   - OAuth consent screen: External, app name MedSociety, `medsociety.one` as an authorized domain, links to
     the privacy policy and terms pages.
   - Scopes: `openid`, `email`, `profile` only, so Google's app-verification review is not triggered.
   - OAuth Client ID, type Web application, redirect URI
     `https://gbfbsecjgjmqoznebwwb.supabase.co/auth/v1/callback`.
2. **Supabase → Auth → Providers → Google**
   - Paste the client ID and secret.
   - Keep **"Confirm email" ON** (HANDOFF.md section 9 depends on it).
   - Leave manual identity linking off for now.
3. **Supabase → Auth → URL configuration**: add to the redirect allowlist
   - `https://medsociety.one/**`
   - `https://www.medsociety.one/**`
   - `http://localhost:5174/**`
   - the Vercel preview pattern, if testing on previews
4. **Branding.** Google's account picker will say "continue to gbfbsecjgjmqoznebwwb.supabase.co". Showing
   `auth.medsociety.one` instead needs Supabase's paid custom-domain add-on. Launching without it is fine.

## Phase 1: code (one PR)

1. **`src/lib/auth.ts`**: add `signInWithGoogle(next)`.
   - Calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: origin + safeNext(next) } })`.
   - Records `track('sign_in', { method: 'google' })` and returns `{ error }`, like the other functions.
   - Keep the default implicit flow. `useSession` already picks up the session on return. Switching to PKCE
     would break email-confirmation links opened on another device.
2. **`safeNext()` helper (security fix).**
   - Today `LoginPage` builds `${origin}${next}` from the URL unchecked. `?next=@evil.com` becomes
     `https://medsociety.one@evil.com`, an open redirect.
   - Accept only paths that start with `/` and not `//`. Use it for both the Google and email redirects.
3. **`src/pages/LoginPage.tsx`**: "Continue with Google" button above the form, with an "or" divider. Works in
   both sign-in and sign-up modes and keeps `next`.
4. **`BorderhealthOnboarding.tsx` `AuthForm`**: same button, `redirectTo: resumeUrl()`.
   - Check first that `savePending` / `readPending` store everything the claim or listing step needs before the
     full-page redirect.
5. **Shared `GoogleButton`** in `src/components/account/`. Follows Google's branding rules (official G mark,
   "Continue with Google" / "Continuar con Google"). Add the i18n keys in EN and ES.
6. **In-app browsers.** Google blocks OAuth inside embedded webviews such as WhatsApp, Instagram and Facebook
   (`disallowed_useragent`), and much of the traffic arrives through WhatsApp.
   - Detect those browsers and replace the button with a short "open in your browser to use Google" hint.
   - Email and password sign-up stays available.
7. **Error on return.** If Google sends the person back with `#error=access_denied` or similar, show a clear
   message on `/login` instead of failing silently.
8. **Dashboard**: show "Signed in as {email}". A doctor whose claim was made under `work@clinic.com` who signs in
   with a personal Gmail gets a separate, empty account; this line makes that visible.

## Phase 2: optional, later

- **Connect Google from an account page**: `linkIdentity()`, which needs manual linking turned on. Lets a doctor
  attach a Gmail to an existing work-email account.
- **Admin dashboard**: show each user's sign-in method (`raw_app_meta_data->>'provider'`). Small read-only
  change to the admin RPC.
- **Google One Tap** on the home page for patients.

## Risks to check in testing

- **Account takeover before sign-up**: someone registers `victim@gmail.com` with a password and never confirms,
  then the real owner signs in with Google. Supabase says it drops unconfirmed identities when it links
  automatically; test this on staging rather than trust it.
- **`www` vs apex host**: the session is stored per host, so a sign-in must return to the host it started on.
  Both hosts go in the allowlist.
- **Doctor subdomains** (`*.medsociety.one`): out of scope. Sign-in happens only on the main site.

## Testing

- On localhost: new Google user; existing password user with the same email (`user.id` must not change);
  invite acceptance; `/borderhealth` resume; sending an inquiry while signed out.
- `npm run build`, plus a manual pass in both languages.
- One pass on a phone inside WhatsApp's in-app browser.

Estimate: about a day of code once Phase 0 is done.
