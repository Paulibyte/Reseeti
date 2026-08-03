# Reseeti — Stage 25: Security & Access Controls

Ten items, three genuinely new categories of work:

- **Account security** (2FA, sessions, devices, login alerts) — all new,
  mostly built on Supabase Auth's own native capabilities rather than
  reinvented.
- **App-level hardening** (rate limiting, CSRF, encrypted local storage)
  — all new, all schema/browser-API-based, no new paid services.
- **Audit/activity visibility + webhook hardening** — partly new (a
  proper in-app log viewer), partly reinforcing what already existed
  (webhook signatures were already verified since early stages; this
  hardens the comparison itself).

## 1. Two-factor authentication

Real TOTP 2FA (Google Authenticator, Authy, etc.), built entirely on
Supabase Auth's native MFA support — no custom crypto, no new table.
`/dashboard/security` → **Set up 2FA** calls `supabase.auth.mfa.enroll()`,
shows the QR code it returns, and confirms with `mfa.challenge()` +
`mfa.verify()`. Once enrolled, `app/login/page.js`'s flow changes: after
the existing phone-OTP step succeeds,
`supabase.auth.mfa.getAuthenticatorAssuranceLevel()` checks whether a
second factor is actually required for this account, and if so shows a
new "Enter your 2FA code" step before finishing sign-in. Accounts
without 2FA enrolled see no change at all to their login flow.

Available to **every role**, not just the owner — 2FA protects one
person's own login, so a cashier or manager can turn it on for their own
account regardless of what they're allowed to do inside the business.

## 2. Rate limiting

`lib/rateLimit.js` + `schema_stage25.sql`'s `increment_rate_limit()`
Postgres function — atomic across concurrent serverless invocations,
which an in-memory counter can't be (Vercel functions don't share memory
between instances). Applied to every mutating route added in Stages
22–24 that didn't already have a natural cap: AI parse-invoice (30/hr),
AI insights (6/hr), AI receipt extraction (30/hr), manual reminder
sending (10/hr), backup runs (10/hr) — all keyed per-business, so one
business's usage never affects another's limit. Fails **open** (allows
the request) if the rate-limit check itself errors, since a broken
limiter taking down the app is worse than occasionally missing a
would-be-blocked request.

Login itself isn't rate-limited by this app's own code — Supabase Auth
already enforces its own SMS OTP rate limits at the platform level,
independent of anything here.

## 3. CSRF protection

Double-submit cookie pattern (`lib/csrf.js` + `app/api/csrf/route.js` +
`lib/csrfFetch.js`). A random token cookie is set once per browser on
app load (`RegisterSW.jsx`); every mutating request to this app's own
cookie-authenticated API routes must echo it back as a header, verified
with a timing-safe comparison. Applied to every POST/DELETE route added
in Stages 22–25 that authenticates via the Supabase session cookie:
the AI routes, backup run/disconnect, reminders send, and the new
device/login-alert routes below.

Routes that instead authenticate via a Bearer token (the normal
supabase-js client calls the rest of the app already makes directly to
Supabase's REST API) don't need this — a forged cross-site request has
no way to attach an Authorization header either, which was already
protection Reseeti had without anyone building it specifically. This is
a second, independent layer on top of the Supabase session cookie's own
`SameSite=Lax` setting, not a replacement for it.

## 4. Audit logs & 10. Activity log

One page, two tabs (`/dashboard/activity`, owner-only) — deliberately
built as one system rather than two, since they're the same underlying
data (the `events` table, introduced back in Stage 5) viewed two ways:

- **Activity** — what happened in the business: invoices marked paid,
  reminders sent, upgrades completed.
- **Security** — sign-ins and account security changes: `login_success`,
  `mfa_enrolled`/`mfa_unenrolled`, `signed_out_everywhere`,
  `device_forgotten`.

`events` was originally built with **no client read access at all** —
its Stage 5 migration comment says as much, on the assumption you'd
query it directly in the Supabase dashboard. `app/api/activity/route.js`
is the considered exception: owner-only, strictly scoped to that
owner's own `business_id`, paginated — reasonable now that there's an
actual in-app need for a business owner to see their own history.

## 5. Device management

`user_devices` table + the Security page's device list. **Important
limitation, stated plainly**: this is an informational record of which
browsers/devices have signed in and when — not a live list of active
sessions. Supabase Auth doesn't expose per-session listing or targeted
revocation to the client, so "Forget this device" only removes it from
this list (and stops it counting as "known" for login alerts); it does
**not** sign that device out. The real "kick a device out" action is
Session management below.

`device_id` is a random id the browser generates for itself once
(`lib/deviceId.js`) and keeps in localStorage — not a hardware
fingerprint. A different browser, profile, or cleared storage naturally
looks like a "new" device, which is the correct behavior from this app's
perspective.

## 6. Session management

**Sign out of all other devices** on the Security page, using
`supabase.auth.signOut({ scope: 'others' })` — a real Supabase Auth
capability that terminates every session for the account except the
current one. This is the actual security lever (not the device list
above) for "I think someone else has my login."

## 7. Login alerts

An SMS (via the existing Twilio integration, reused as-is) sent when an
account signs in from a device it hasn't seen before —
`app/api/security/login-event/route.js`, called right after every
successful login. Toggleable per-person on the Security page
(`business_members.login_alerts_enabled`, on by default). Uses SMS
rather than email specifically because Reseeti accounts are phone-based
with no email requirement — the phone number is the one contact channel
guaranteed to exist for every account.

## 8. Encrypted local storage

The offline invoice draft queue (`lib/offlineQueue.js`, since early
stages) used to write customer names, phone numbers, and amounts to
localStorage as plain JSON. It's now encrypted at rest
(`lib/encryptedStorage.js`) with AES-GCM, using a non-extractable
CryptoKey generated once per browser profile and stored directly in
IndexedDB via the Web Crypto API — the key material itself is never
exposed as bytes this code could log or leak.

**Stated threat model**: this does not protect against same-origin
JavaScript reading the data — a real XSS vulnerability would defeat it
completely, since malicious same-origin code can ask for decryption the
same way this code does. What it protects against is anything reading
browser storage files *without* running JS in this origin: another
local app with disk access, a browser extension with broad storage
permissions, or someone with physical access to a shared/borrowed device
poking at the profile folder directly — a real scenario for shared shop
computers. Every existing caller of the queue (`InvoiceForm.jsx`,
`dashboard/page.js`) keeps working completely unchanged and
synchronously; the encryption happens underneath via an in-memory cache
kept in sync with the encrypted on-disk copy in the background. A
pre-upgrade plaintext queue is detected and migrated automatically the
first time this code runs after updating.

## 9. Webhook signature verification (hardened)

Already implemented since early stages for all three payment
gateways — Paystack, OPay, and Monnify each verify an HMAC signature
before trusting a webhook body. What changed: the comparison itself
(`expected === received`) has been replaced with
`lib/crypto.js`'s `timingSafeEqualHex()`, a constant-time comparison. A
naive string comparison short-circuits at the first differing
character, which leaks (hard to exploit remotely, but real) timing
information about how many leading bytes of a guess were correct — the
same reasoning applied to `lib/csrf.js`'s token comparison.

## Setup

### 1. Run the migration
`supabase/schema_stage25.sql` — adds `rate_limits`, its
`increment_rate_limit()` function, `user_devices`, and
`business_members.login_alerts_enabled`.

### 2. Confirm MFA is available on your Supabase project
Supabase Auth → Providers → Multi-Factor Authentication should already
be enabled by default on new projects; worth a quick check in your
project's Auth settings if `Set up 2FA` errors on the Security page.

### 3. No new environment variables
Every piece here builds on `ENCRYPTION_KEY` (already added in Stage 24
for backup token encryption), Twilio (already configured for SMS
reminders), and Supabase's own built-in capabilities.

### Test it
1. **2FA**: enroll on the Security page, sign out, sign back in — confirm
   the new 6-digit-code step appears and a wrong code is rejected.
2. **Rate limiting**: hit "Generate insights" on Analytics more than 6
   times in an hour — confirm the 7th attempt is rejected with a clear
   message, not a 500.
3. **CSRF**: open DevTools, clear the `reseeti_csrf` cookie, try
   "Send reminders now" — confirm it's rejected (then reload, which
   re-sets the cookie via `RegisterSW.jsx`, and confirm it works again).
4. **Audit/Activity log**: perform a few actions (mark an invoice paid,
   sign in on a second browser) and confirm both show up under the
   right tab on `/dashboard/activity`.
5. **Devices/sessions**: sign in from a second browser, confirm it
   appears in the Security page's device list and (if login alerts are
   on) a text arrives. Click "Sign out of all other devices" and confirm
   the second browser is actually signed out on its next request.
6. **Encrypted storage**: go offline, save a draft invoice, then check
   Application → Local Storage in DevTools — confirm
   `reseeti_offline_queue_v2`'s value is unreadable ciphertext, not
   plain JSON.
7. **Webhooks**: unchanged behavior — a real Paystack/OPay/Monnify test
   webhook should still be accepted exactly as before.

## What's deliberately left out of this stage

- **True per-device session revocation** — repeated above because it's
  the single most important limitation to understand: Supabase Auth
  doesn't expose the granularity needed to list or kill one specific
  session by device. "Sign out of all other devices" (global-minus-current)
  is the real lever; a device-by-device kill switch would need Supabase
  to expose that capability first.
- **CSRF protection on every single API route** — applied specifically
  to cookie-authenticated mutating routes from Stages 22–25. Routes
  authenticated via Bearer token (the direct-to-Supabase pattern most of
  the app's own data operations use) don't need it, as explained above;
  a systematic audit of every future route as it's added is a process
  change, not a one-time code change.
- **IP-based rate limiting on unauthenticated routes** — the webhook
  endpoints and public receipt-page routes aren't rate-limited by this
  stage (signature verification and the verification-code check already
  gate them); revisit if abuse is actually observed there.
- **A visible admin-configurable rate-limit dashboard** — limits are
  hardcoded per route rather than exposed as tunable settings anywhere.
  Reasonable starting points, not necessarily final numbers.
- **Encrypting IndexedDB caches beyond the offline queue** (Stage 19's
  `idbCache.js` read-side cache, Stage 24's cloud backup tokens table) —
  the offline queue was the one holding genuinely sensitive customer
  PII in a form actually readable at rest before this stage; the
  IndexedDB read cache is just-fetched business data already visible on
  screen, and backup tokens already go through `lib/crypto.js`'s
  server-side encryption separately.
