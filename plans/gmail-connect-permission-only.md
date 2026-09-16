# Connect Gmail as a permission, not a sign-in — 2026-09-16

## Problem

"Connect Gmail Inbox" (Pending, Settings) called `signInWithGoogle(path, true)`:
a full Supabase sign-in with Google that also asked for `gmail.readonly`. If the
user picked a different Google account on Google's chooser, Supabase signed them
into the Intrack account for that address — **creating a new trial account if
none existed** — and their real data appeared to vanish.

Commit `c7881fc` (unpushed) only switched the user back afterwards. It could not
stop the account being created, because Supabase creates it before app code runs.

## Owner decisions (2026-09-16)

1. Connect Gmail must **never create or switch an Intrack account**. Accounts are
   created only through the sign-up portal.
2. The connected Gmail address must **equal the Intrack login email**. A different
   pick is refused, the permission just granted is **cancelled at Google**, and the
   user is told which account to pick. Accepted consequence: a user whose login
   email is not a Google account cannot connect Gmail.
3. **Disconnect Gmail must always cancel the permission at Google.** Today it only
   does so for users with a pre-2026-08-27 refresh token stored server-side;
   everyone else only had the browser copy forgotten, while README and
   `user_login_guide.md` promise revocation.

## Design

Connect Gmail uses Google Identity Services' **token client**
(`google.accounts.oauth2.initTokenClient`) in a popup. It returns an access token
for `gmail.readonly` and never touches the Supabase session, so no account can be
created or switched. Same OAuth client and scope as before, so Google verification
status carries over.

After the popup returns a token:

1. Check the Gmail scope was actually granted (granular consent lets the user
   untick it). If not → refuse.
2. `GET gmail/v1/users/me/profile` → `emailAddress`. Compare with the Supabase
   user's email (case-insensitive; for gmail.com/googlemail.com also ignore dots
   and `+tag`). Mismatch → revoke the token at Google, refuse with the picked
   address. Profile call fails → refuse without revoking (it may be the right
   account; the user retries).
3. Match → `saveGoogleToken(token)`, `hasGoogleToken = true`.

`login_hint` is set to the login email so Google pre-selects the right account.

Disconnect: `disconnectGmail` also revokes the browser access token at
`https://oauth2.googleapis.com/revoke` (best-effort) before clearing it, in
addition to the server-side refresh-token revoke. Account deletion uses the same
function and benefits too.

Unchanged: Google sign-in (basic scopes, still Supabase), the legacy
refresh-token path, the scanner engine and how it reads the token.

## Phases

**Phase 1 — remove the `c7881fc` guard.** Delete `gmailConnectGuard.ts` and its
test, the guard code and dialog in `AuthContext`, and its ARCHITECTURE paragraph.

**Phase 2 — `src/services/gmailConnect.ts`.** GIS script loader (preloaded when
Pending/Settings mount, so the popup opens inside the click's user activation),
`connectGmailInbox({ clientId, loginEmail }, deps)` with injectable deps, email
normalisation, result → user message mapping. Unit tests including the
wrong-account revoke.

**Phase 3 — wire it in.** `AuthContext.connectGmail()`; `signInWithGoogle` loses
its Gmail-scope parameter and the `intrack_requesting_gmail_scope` flag (leftover
key removed on load). Pending and Settings call `connectGmail()`.

**Phase 4 — Disconnect revokes the browser token.** `disconnectGmail` in
`googleAuth.ts`, with tests.

**Phase 5 — config and docs.** `VITE_GOOGLE_CLIENT_ID` (same value as
`GOOGLE_CLIENT_ID`) in `.env.example`; CSP in `vercel.json` allows
`https://accounts.google.com` (script, style, frame, connect). Update
ARCHITECTURE §7, README, `user_login_guide.md`, `GOOGLE_VERIFICATION_GUIDE.md`.

## Owner actions before deploy

1. Google Cloud console, project `dhanrakshak-497806`, the OAuth web client used by
   Supabase: add every site origin (production domain, Vercel preview domain,
   `http://localhost:5173`) under **Authorized JavaScript origins**.
2. Vercel: add `VITE_GOOGLE_CLIENT_ID` (public value) to Production and Preview,
   then redeploy (read at build time).

## Known limits

- Disconnect can only revoke a browser token that is still present (under ~58
  min old); an expired one has nothing left to revoke from the client.
- Revoking a wrong pick cancels **all** of Intrack's permissions for that Google
  account, including one it granted as a separate Intrack user.
- Google blocks its consent pages inside embedded app webviews; the Capacitor
  build was untested before this change and remains so.
- Google's demo video for verification must show the popup flow.
