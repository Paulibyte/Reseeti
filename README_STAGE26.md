# Reseeti — Stage 26: Subscription Enforcement & Multi-Device Sync

Two unrelated halves that shipped together. Both surfaced a real,
pre-existing gap while being built — worth reading even if you only
care about one half, since both fixes matter for production use.

## Part 1 — Subscription enforcement

### The bug this stage found and fixed
`app/dashboard/page.js` already referenced `platform_settings` (a global
free-plan-limit config table) and `businesses.monthly_invoice_limit` (a
per-business override) — but **neither ever existed in any migration**.
Every read silently returned nothing and fell back to a hardcoded
default of 5, which happened to match the intended default, so the bug
was invisible... until you actually wanted to change that limit from the
SQL editor rather than a code deploy, at which point it would have
silently done nothing. `schema_stage26.sql` creates both properly.

### "Users should never be able to bypass Pro" — the actual fix
Before this stage, the free-plan invoice limit was enforced **only** by
the dashboard UI hiding the "+ Create Invoice" button once a business
hit its monthly count. That does nothing to stop a direct `supabase-js`
call — e.g. from the browser's own dev console, already authenticated —
that skips the UI entirely and inserts a row straight into `invoices`.

The real fix is a **database trigger**
(`enforce_invoice_plan_limit()`, fires `BEFORE INSERT ON invoices`):
it looks up the business's plan and effective limit, counts this
month's invoices, and raises an exception — rejecting the insert — if a
free-plan business is at its limit. This fires for *every* insert
regardless of which code path or role performs it: the normal invoice
form, the offline sync queue, a raw API call, anything. There is no
route around it anymore.

`InvoiceForm.jsx` already always goes through the offline draft
queue (`lib/offlineQueue.js`) rather than inserting directly — so the
one place that needed updating for this new possible rejection was
`syncQueue()`'s error handling: it now recognizes the trigger's specific
error message and marks that draft `blocked_plan_limit` instead of
endlessly retrying it like a network hiccup. The dashboard shows a
clear "N queued invoices couldn't sync — you've reached this month's
limit" banner with an Upgrade button, rather than a draft silently
stuck in limbo forever.

### Recurring subscription
Already implemented (Paystack's Plan/Subscription API — genuine
auto-recurring billing, no re-entering card details each month). OPay
and Monnify don't have an equivalent recurring primitive on their
Cashier/Checkout products, so those two remain "pay again in ~30 days"
flows — the grace period below is what makes that gap survivable rather
than a hard cutoff the moment 30 days pass.

### Expired subscription handling + 7-day grace period
New: `app/api/subscription/check-expiry/route.js`, a daily cron
(`vercel.json`). Two things it does that webhooks alone can't:
webhooks only fire on payment *attempts* — they never tell you about a
subscription that just quietly stops being charged (an expired card
with no retry, a Paystack subscription that lapsed without ever sending
`subscription.disable`, an OPay/Monnify renewal nobody came back to
pay). Only a scheduled check of "has `plan_renews_at` actually passed"
catches that.

- **Day the subscription lapses**: `plan_grace_until` is set to 7 days
  out, an SMS nudge goes out, and — importantly — **Pro features keep
  working throughout the grace period**. `plan` stays `'pro'` the whole
  time; only the free-invoice-limit trigger cares about `plan`, and it
  already skips any non-free plan.
- **7 days later, still unpaid**: `plan` flips to `'free'`,
  `plan_grace_until` clears, another SMS goes out.
- **Paid at any point during grace**: all three webhook handlers now
  clear `plan_grace_until` back to `null` on a successful charge, so
  grace just quietly ends the moment payment succeeds.

The dashboard shows a red "your last payment didn't go through, you
have until [date]" banner throughout grace, with an Update Payment
button, so nobody discovers the countdown by surprise when it ends.

### Payment history
Already implemented (`/dashboard/payments`) — collected/outstanding
stats, recent customer payments, and a unified Paystack/OPay/Monnify
gateway activity feed. Unchanged in this stage.

### Invoices for subscription
New: a **Receipt** button next to every successful subscription payment
on the Payments page, generating a simple PDF
(`lib/subscriptionReceipt.js`) — vendor (Reseeti), amount, date,
payment method, reference. Deliberately not the same
html2canvas-screenshot pattern the customer-facing invoice receipt uses
— a few lines of text don't need a rendered DOM element to screenshot,
so this uses jsPDF's own drawing API directly.

## Part 2 — Multi-device sync

### Automatic sync + background syncing
The offline invoice queue already had two automatic triggers (the
`online` browser event, and the Background Sync API for when the tab
isn't even open). This stage adds two more, closing gaps neither
covered:
- **`visibilitychange`** — catches switching away from the tab and back
  (answering a call, checking WhatsApp) without the tab ever truly going
  offline/online, during which another device could have changed things.
- **A 60-second interval** — catches a tab just left open and idle for a
  long stretch, so it doesn't go stale (queued edits, another device's
  changes) for the whole time someone's looking at it.

### Live cross-device propagation (the actual "stay synchronized" part)
New: `lib/useRealtimeSync.js`, a thin wrapper around Supabase Realtime's
Postgres Changes — a live websocket stream of inserts/updates/deletes,
scoped per business. Wired into the three places it matters most:
`invoices` on the dashboard, `products` on Inventory, `customers` on the
Customers page. A sale rung up on a phone shows up on a tablet's
dashboard within about a second, no manual refresh — this is the
concrete version of "trader uses Phone → Tablet → Laptop, everything
stays synchronized." Needs the three tables added to Supabase's
`supabase_realtime` publication, which `schema_stage26.sql` does.

### Offline edits
Before this stage, editing an existing product or customer while
offline just failed outright — there was no queueing for anything
except *creating* a new invoice. `lib/offlineQueue.js` gained a second,
generic kind of queued entry (`queueEdit`/`syncEdits`, alongside the
existing invoice-draft-specific logic) for edits to an existing row.
Wired into `ProductForm.jsx`'s edit path and the customer profile edit
page — editing while offline now queues the change and updates this
device's own view immediately, instead of failing.

**Scope note**: this covers *edits* to existing products/customers, not
*creating* new ones offline — a new record needs a temporary local ID
and a replacement flow once it syncs (the same complexity invoice
drafts already solved), which wasn't rebuilt a second time for this
stage. Recording an offline *sale* (new invoice) was already fully
covered before this stage; recording a brand-new product or customer
while offline is a reasonable next addition, not built here.

### Conflict resolution
The genuinely hard part of syncing edits from multiple devices: what if
two devices edit the *same* record while at least one was offline? This
uses optimistic concurrency — `schema_stage26.sql` adds database
triggers (`set_updated_at`) that make `updated_at` a reliable,
tamper-proof version marker on `products`, `customers`, and `expenses`
(previously, `updated_at` was set by client code remembering to include
it in each update payload — easy to get right today, easy to forget in
whatever's added next).

Every queued edit remembers the row's `updated_at` from the moment the
edit was made (`baseUpdatedAt`). On sync:
- **Matches the row's current `updated_at`** → nobody else touched it,
  apply safely.
- **Doesn't match** → a real conflict, another device changed this exact
  row in between. The edit is **not** silently applied over the other
  change, and the other change is **not** silently kept either — it's
  left for a person to decide, via the new **Sync Conflicts** modal
  (`SyncConflictModal.jsx`, surfaced on the dashboard): "Keep my
  change" (apply it anyway, on top of whatever's there now) or "Discard
  my change" (keep the other device's version).

Deliberately record-level, not field-by-field — showing which
individual field differs would need diffing every field of every
conflicting row, real complexity for something that should only happen
rarely (the same record edited on two devices while at least one was
offline).

## Setup

### 1. Run the migration
`supabase/schema_stage26.sql` — creates `platform_settings` (fixing the
bug above), adds `businesses.monthly_invoice_limit` /
`plan_grace_until`, the invoice-limit-enforcement trigger, `updated_at`
+ its auto-update trigger on `expenses` (new) and `products`/`customers`
(replacing client-set timestamps), and turns on Realtime replication for
`invoices`/`products`/`customers`.

### 2. No new environment variables
Everything here builds on infrastructure already configured (Twilio for
SMS nudges, the existing payment gateway credentials, Supabase itself
for Realtime).

### Test it
1. **Bypass prevention**: as a free-plan business at its limit, open
   the browser console and try
   `await supabase.from('invoices').insert({...})` directly — confirm
   it's rejected with the trigger's message, not silently accepted.
2. **Grace period**: manually set a test business's `plan_renews_at` to
   yesterday via the SQL editor, trigger the cron route manually (or
   wait for its schedule), confirm `plan_grace_until` gets set, the
   dashboard shows the red banner, and Pro features still work. Set
   `plan_grace_until` to yesterday too and re-trigger — confirm it
   downgrades to `free`.
3. **Subscription receipt**: on the Payments page, click **Receipt**
   next to a successful payment — confirm a sensible PDF downloads.
4. **Realtime sync**: open the dashboard in two browser windows (or two
   devices) signed into the same business. Mark an invoice paid in one
   — confirm the other updates within a second or two with no refresh.
   Same test on Inventory (edit a price) and Customers (edit a phone
   number).
5. **Offline edits + conflicts**: go offline in one browser tab, edit a
   product's price, stay offline. In a second tab (still online), edit
   that same product's price to something different and save. Go back
   online in the first tab — confirm a conflict is detected and the Sync
   Conflicts modal lets you pick which price to keep.

## What's deliberately left out of this stage

- **Offline creation of new products/customers** — only edits to
  existing records are queued while offline; see the "Offline edits"
  scope note above.
- **Field-level conflict diffing** — conflicts are resolved per record
  ("keep mine" / "discard mine"), not per individual field.
- **Realtime sync for expenses** — `products`, `customers`, and
  `invoices` were the three judged highest-value for "stays
  synchronized across devices"; expenses got the `updated_at` trigger
  (needed for its own offline-edit conflict detection, in case that gets
  built later) but not a live Realtime subscription in this stage.
- **A visible admin UI for `platform_settings`** — the newly-created
  table is still edited directly via the Supabase SQL editor, same as
  before this stage fixed the missing table; a proper admin page for
  platform-wide config is a separate, future piece of work.
- **Automatic retry backoff tuning** — the new 60-second interval sync
  is a fixed interval, not an exponential-backoff scheme. Fine at the
  request volumes a small business generates; worth revisiting if it
  ever needs to scale down aggressively for battery/data reasons.
