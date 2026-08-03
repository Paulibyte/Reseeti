# Reseeti — Stage 21: Diagnostics page

Stages 19 (Performance) and 20 (PWA Improvements) added a lot of
machinery — IndexedDB caching, a virtualized invoice table, Background
Sync, service-worker update handling, cache-size trimming, install
prompting — that's genuinely invisible on a normal day. It only shows
itself as "the app felt fast" or "my offline invoice synced later,"
which is the right outcome, but makes it hard to *confirm* any of it is
actually working without opening DevTools and digging through
Application → Service Workers / Cache Storage / IndexedDB by hand every
time — as a support conversation, that's also not something you can ask
a non-technical business owner to go do.

This stage adds one page: **Diagnostics**
(`/dashboard/diagnostics`, `app/dashboard/diagnostics/page.js`), gated
behind `manageSettings` (owner-only, same as Business Settings) since
it's technical/system-level information, not a day-to-day business
screen.

## What it checks

Everything on the page reads real, live browser state on load —
nothing is mocked or hardcoded:

- **Connection** — `navigator.onLine`.
- **Service worker** (Stage 9 / 19 / 20) — registered? which state is
  the active worker in? is there a version waiting (should match
  whether the update-notification banner is showing)? does this browser
  support Background Sync at all? Includes a **"Check for update now"**
  button that calls `registration.update()` directly.
- **Cache Storage** (Stage 19 / 20) — every cache name currently open,
  with an entry count each (useful for confirming the entry cap from
  Stage 20 is actually holding). Includes a **"Clear all caches"**
  button (with a confirm dialog) for forcing a clean-slate re-test.
- **IndexedDB read cache** (Stage 19) — row counts in the
  `invoices`/`customers`/`products` stores for the signed-in business
  (`lib/idbCache.js`).
- **Offline invoice queue** (Stage 9 / 19) — pending and failed draft
  counts from `lib/offlineQueue.js`.
- **Install state** (Stage 20) — already installed? is a
  `beforeinstallprompt` currently available? which platform path
  (`lib/pwa.js`'s standard vs. iOS-manual detection)?
- **Manifest** — confirms `/manifest.json` is actually reachable and
  parses, and reports its name/icon count.

A green dot means "this looks right," red means "this looks wrong,"
and gray means "this reading isn't a problem either way" (e.g. no
install prompt available because the app is already installed — that's
a fine, expected state, not a failure).

**"Copy report"** puts the full JSON snapshot on the clipboard — meant
for pasting into a support conversation rather than walking a
non-technical business owner through DevTools themselves.

## Setup

No migration, no new dependencies. Nothing here writes anything except
the two explicit destructive actions (Clear caches), both behind a
button click and a confirm dialog.

### Test it
1. Sign in as an Owner, open Diagnostics from the sidebar (🛠️) — confirm
   a Manager/Cashier/etc. account gets "You don't have permission" if
   they navigate there directly.
2. Cross-check a few rows against Stage 19/20's own test steps (e.g. go
   offline and confirm the offline-queue count updates on Refresh,
   force a service-worker update and confirm "Update waiting" flips to
   Yes and matches whether the toast banner is showing).
3. Click "Clear all caches," confirm the Cache Storage section drops to
   0 entries, then revisit a few pages and confirm they repopulate.

## What's deliberately left out of this stage

- **Automated checks / pass-fail summary** — this page reports state,
  it doesn't run assertions or grade itself "healthy/unhealthy" as one
  number. That's a reasonable next step if this page gets used a lot,
  but a human reading seven small sections was enough for what this
  stage needed to solve.
- **Server-side diagnostics** (Supabase connectivity, RLS checks, webhook
  delivery status) — everything here is client/browser-side on purpose,
  matching the client-side nature of everything Stage 19/20 added. Any
  future server-health page would be a different, separate piece of
  work.
