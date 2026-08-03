# Reseeti — Stage 5: Offline-first drafting & basic analytics

This stage is different from the earlier ones: it doesn't add a feature a
business owner asks for by name, it makes the app trustworthy in the
conditions it'll actually be used in — patchy data, mid-sale, no signal —
and gives you visibility into how people actually use it once real users
show up.

## Part 1 — Offline-first invoice drafting

**The problem:** a trader creating an invoice mid-sale with no signal
shouldn't lose that invoice, or be blocked from finishing the sale.

**How it works:**
1. `lib/offlineQueue.js` — every "Save invoice" click writes to
   `localStorage` **first, instantly, unconditionally**. This never fails
   and never waits on a network call.
2. If the browser is online, the app then immediately tries to push that
   draft (and anything else still queued) to Supabase in the background.
3. If it's offline, or the push fails for any reason, the draft just stays
   in the local queue.
4. The dashboard listens for the browser's `online` event and automatically
   retries syncing the moment connection returns — no manual refresh
   needed, though a **Sync now** button is there too if someone wants to
   force it.
5. A banner at the top of the dashboard shows the current state: offline
   warning, "X invoices waiting to sync," or nothing at all once everything's
   synced.

**What this deliberately does NOT do:** multi-device conflict resolution.
If the same business is logged in on two devices and both go offline and
create invoices, both sets sync fine (they're independent inserts) — but
this isn't solving the harder problem of *editing* the same record from
two offline devices at once. That's a much bigger architecture problem;
not needed for how this app is actually used (one owner, one phone,
mostly).

**A minimal service worker** (`public/sw.js`) also caches the app shell
itself, so the app's pages load even with zero connectivity — not just the
invoice data. It's intentionally simple (no Workbox, no precache manifest)
to avoid fighting Next.js's hashed build filenames; it just caches
same-origin pages as they're visited.

**PWA manifest** (`public/manifest.json`) means Android users can
"Add to Home Screen" and get an app-like icon and standalone window. You'll
need to add real `icon-192.png` and `icon-512.png` files to `public/` —
placeholders aren't included.

## Part 2 — Basic analytics

**Why self-hosted instead of PostHog/Mixpanel/etc:** no third-party script
to load, no separate account to set up, no extra privacy/consent
conversation with users about a third party. Events land in your own
`events` table in Supabase — query them directly.

**What's tracked so far** (see `lib/analytics.js` and its call sites):
- `invoice_created`
- `reminder_sent`
- `upgrade_clicked` (button tapped) vs `upgrade_completed` (webhook
  confirms payment) — comparing these two tells you your actual
  Free→Pro conversion rate, not just intent

**To see your data:** Supabase Dashboard → Table Editor → `events`, or
write SQL directly. A few starter queries are included as comments at the
bottom of `supabase/schema_stage5.sql`.

**Note on the public `/inv/[id]` page:** it isn't instrumented yet in this
stage, since that page is unauthenticated and the current `events` RLS
policy is scoped to signed-in users writing their own `user_id`. Adding
tracking there (e.g. "customer opened their invoice link") needs a
slightly different policy — a good next addition once you want that data,
flagged here rather than silently skipped.

## Setup

### 1. Run the migration
Supabase SQL editor → run `supabase/schema_stage5.sql`.

### 2. Install and run
```
npm install
npm run dev
```

### 3. Test offline mode
In Chrome DevTools → Network tab → set throttling to **Offline**. Create
an invoice — it should save instantly with no error, and the dashboard
should show the offline banner. Switch back to **Online** and watch it
auto-sync within a moment.

## What's deliberately left out of this stage
- **Editing an offline-created invoice before it syncs** — currently the
  draft is fixed once queued. Worth adding once you see whether people
  actually need to correct a draft before it syncs.
- **A visible analytics dashboard inside the app** — right now "looking at
  the data" means opening Supabase directly. Building an in-app summary
  view is worth doing once you know which numbers you actually check
  often.
- **Retrying failed (not just offline) syncs with backoff** — a sync that
  fails for a real error (not just "offline") currently just sits queued
  until the next natural sync trigger, rather than retrying on a timer.

## Next: Stage 6 (not yet scoped)
This closes out the roadmap sketched in Stage 1's README. Worth pausing
here, using the app for real, and letting actual usage — and the
`events` table — tell you what Stage 6 should even be, rather than
guessing further ahead.
