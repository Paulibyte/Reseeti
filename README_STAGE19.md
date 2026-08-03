# Reseeti — Stage 19: Performance

Up to now every dashboard page has followed the same shape: fetch
everything for the business, hold it all in React state, render all of
it. That's simple and it's been fine — but it stops being fine once a
business has been using Reseeti for a year and has a few thousand
invoices, a few hundred customers, and a product catalog with real
depth. This stage doesn't add any new business feature; it makes the
existing app stay fast as that data grows, and stay usable on the
patchy connections a lot of Reseeti's traders are actually on.

Eight things changed, each addressing a different part of "why does
this feel slow":

## 1. The dashboard's invoice query stopped fetching what it doesn't use

The single biggest fix in this stage. `dashboard/page.js`'s `load()`
used to run:

```js
.from('invoices').select('*, invoice_items(*)')...
```

for every invoice, unconditionally, on every dashboard visit — to
compute four stat numbers and render eight rows. Nothing on that page
reads a line item. For a business with, say, 40 invoices averaging 4
items each, that's 160 extra rows pulled and parsed for zero benefit;
for a business with 3,000 invoices it's a genuinely slow request. The
query is now `select('id, invoice_number, customer_name, total, paid,
created_at')` — exactly the columns the stat cards and notifications
read.

## 2. Pagination — Customers and Inventory

Both lists used to render every row returned from the database in one
`.map()`. They now render 25 at a time with Prev/Next controls
(`app/dashboard/customers/page.js`, `app/dashboard/inventory/page.js`).
Search still runs against the full loaded set (so results aren't
missing anything one page back), and changing the search text resets
back to page 1.

This is deliberately the simple form of pagination — client-side, over
data already fetched — not server-side `.range()` pagination. Customer
and product counts are bounded by how many people/items a business
actually has, which is a much smaller number than invoice count for
almost every business on the platform; fetching "all customers" is
still a light query even at a few thousand rows. See `schema_stage19.sql`
for the composite indexes (`business_id, name`) that keep that query's
`ORDER BY name` cheap as the table grows.

## 3. Infinite scrolling + virtualized invoice table

Invoices are a different story — this is the number that actually gets
large — so the dashboard's invoice list (`app/dashboard/VirtualInvoiceList.jsx`)
works differently from Customers/Inventory:

- **Infinite scroll**: it fetches 30 rows at a time directly from
  Supabase via `.range()`, ordered by `created_at`, and loads the next
  30 automatically via an `IntersectionObserver` watching a sentinel
  element below the last row — no "Load more" click needed, and no
  scroll-event listener running on every pixel of scroll.
- **Virtualization**: as that list grows (page 2, 3, 10…), only the
  rows within ~600px of the visible viewport are actually mounted as
  DOM nodes. Rows above/below that band are replaced with a single
  spacer `<div>` of the right height. A business scrolled halfway
  through 2,000 invoices still only has ~20 row elements in the DOM,
  not 2,000.

The list manages its own fetching and paging state internally — the
dashboard page just passes it a `refreshToken` number that it bumps
after any action (mark paid, delete, new invoice saved) to tell the
list to reload from page 0.

## 4. IndexedDB caching (stale-while-revalidate)

New: `lib/idbCache.js`. Dashboard, Customers, and Inventory now paint
from the last cached snapshot the instant the page mounts — before the
network request even resolves — then silently replace it with fresh
data once Supabase responds. On a fast connection this is invisible;
on a slow one it's the difference between real (if a few minutes
stale) numbers appearing immediately vs. a blank "Loading…" for
several seconds on every single page visit.

This is IndexedDB, not localStorage, on purpose: localStorage is
synchronous (every read/write blocks the main thread) and effectively
capped around 5MB, which a business with a few thousand invoices could
plausibly approach; IndexedDB is async and has no practical limit for
this use case. It's a pure read-side cache — every read is paired with
a live fetch that overwrites it, and if IndexedDB isn't available at
all (some private-browsing modes), the cache functions no-op and the
page just falls back to its normal loading state.

## 5. Background Sync

The offline invoice queue (`lib/offlineQueue.js`, from an earlier
stage) already wrote drafts to localStorage instantly and synced them
once the browser fired an `online` event. The gap: on mobile, `online`
mostly only fires while the tab is open and in the foreground — someone
who saves an invoice offline, closes the app to take a call, and comes
back online five minutes later might not get an automatic sync at all
until they happen to reopen Reseeti.

`queueDraftInvoice` now also calls `requestBackgroundSync()`, which
asks the browser (via the Background Sync API) to fire a `sync` event
on the service worker once connectivity returns — even with no tab
open. The service worker (`public/sw.js`) can't finish the sync itself
(it doesn't have access to the signed-in user's Supabase session, which
lives in the tab), so its `sync` handler just messages every open
client to say "try now"; `lib/offlineQueue.js`'s
`onBackgroundSyncMessage()` is the client-side listener for that
message, wired up in `dashboard/page.js`. Browsers without Background
Sync support (Safari, Firefox as of this writing) silently skip the
registration — the existing `online`-event path and the "sync on next
app open" fallback still cover them.

## 6. Code splitting

Every modal/overlay component that a typical page visit *doesn't* open
— `InvoiceForm`, `BusinessSettings`, `MarkPaidModal`, `ProductForm`,
and `UpgradeModal` everywhere it appears (8 pages) — is now loaded via
`next/dynamic(..., { ssr: false })` instead of a static top-of-file
import. Previously, visiting any dashboard page downloaded and parsed
all of that page's modals up front, whether or not they were ever
opened; now each is fetched as its own chunk the first time its
`show*` flag flips true. `UpgradeModal` alone was in 8 static imports
across the app — most businesses are Pro or under their free limit and
never see it once.

(The heavy report/PDF libraries — `html2canvas`, `jspdf`, `xlsx` — were
already lazy-loaded via dynamic `import()` inside
`lib/generateInvoicePDF.js` and `lib/exportTable.js` from earlier
stages; that pattern wasn't new to this one.)

## 7. Lazy loading

Two forms of this, on top of the code-splitting above:

- **Images**: the business logo on the dashboard greeting now uses
  `next/image` with `loading="lazy"` (see Image optimization below).
- **Data**: the invoice list's infinite scroll (#3) is itself a form of
  lazy loading — rows past the first page aren't fetched from the
  database at all until the person actually scrolls toward them.

## 8. Image optimization

Added `next.config.js`, configuring `next/image`'s remote patterns for
Supabase Storage (`**.supabase.co/storage/v1/object/public/**`), and
switched the dashboard's business-logo `<img>` to `next/image` — it now
gets automatic resizing, modern-format serving, and lazy loading for
free.

**Not every `<img>` in the app was converted, on purpose.** The
receipt page's QR codes, bank-transfer QR, and signature images
(`app/inv/[id]/ReceiptClient.jsx`) are captured into a PDF by
`html2canvas`, which needs a real, synchronously-loaded `<img>` element
in the DOM (some are cross-origin with `crossOrigin="anonymous"` set
specifically for that capture) — swapping in `next/image`'s lazy
loading and wrapper markup would risk that capture silently missing an
image. Same reasoning for the logo/signature *preview* thumbnails in
`BusinessSettings.jsx`: they're shown inside an open settings modal
immediately after upload, at a fixed 64×64/90×48px, with a fresh
cache-busting URL every time — there's no meaningful optimization or
lazy-loading win there, just a possible delay in showing someone their
own just-uploaded logo. Both were left as plain `<img>` deliberately,
not missed.

Also updated: `public/sw.js` used to exclude every `*.supabase.co`
request from its cache, including Storage — meaning a business's own
logo was re-downloaded from the network on every page load, forever.
The service worker's caching rule now only excludes Supabase's
data-plane endpoints (REST/Auth/Realtime); Storage's public bucket
(logos, signatures) is treated as the static, cacheable asset it
actually is. Cache bumped to `reseeti-shell-v2` so existing installs
pick up the new rule.

## Setup

### 1. Run the migration
Supabase SQL editor → run `supabase/schema_stage19.sql` (after whichever
stage you're currently on). It only adds two indexes
(`customers(business_id, name)`, `products(business_id, name)`) — safe
to run any time, no data changes.

### 2. Update the service worker
No action needed beyond deploying — `public/sw.js`'s version bump
(`reseeti-shell-v2`) makes existing installs replace their old cache
automatically the next time the app is opened.

### 3. Test the full loop
1. Open the dashboard on a business with a handful of invoices. Confirm
   the invoice list still shows everything, in the same order as
   before, with all the same actions (Share, Remind, PAID/UNPAID,
   Delete) working.
2. Scroll the invoice list if you have 30+ invoices — confirm it loads
   more automatically near the bottom rather than needing a click, and
   that it doesn't visually jump or lose your scroll position while
   loading.
3. Reload the dashboard on a throttled connection (Chrome DevTools →
   Network → Slow 3G) — confirm the stat cards show numbers almost
   immediately (from cache) rather than a blank loading state for the
   full request duration.
4. On Customers and Inventory, add enough rows to exceed 25 (or just
   check with existing data) and confirm Prev/Next paging works and
   search resets to page 1.
5. Go offline (DevTools → Network → Offline), save a draft invoice,
   confirm it queues. Go back online — confirm it syncs. This should
   behave exactly as before; the Background Sync addition is a
   resilience improvement for the "app closed while offline" case,
   which is hard to reproduce in DevTools but shouldn't regress the
   existing online-tab-sync path.
6. Open Application → Service Workers in DevTools, confirm the new
   worker (`reseeti-shell-v2`) is active, and that a business's logo
   image shows up under Application → Cache Storage after visiting the
   dashboard once.
7. Click into UpgradeModal, InvoiceForm, Settings, and (on Inventory)
   the product form — confirm each still opens and works normally;
   check the Network tab to see each fetched as a separate chunk on
   first open rather than upfront.

## What's deliberately left out of this stage

- **Server-side pagination for Customers/Inventory** — as explained in
  §2, these lists stay small enough for most businesses that
  client-side paging over a full fetch is the right tradeoff. If a
  business's catalog or customer list grows large enough for this to
  matter, the same `.range()` pattern `VirtualInvoiceList` uses would
  carry over directly.
- **DB-side stat aggregation** — the dashboard's stat cards
  (Outstanding, Collected, unique customers, this-month count) are
  still computed by fetching every invoice's `total`/`paid`/`created_at`
  and reducing client-side. That's now a much lighter fetch than before
  (§1), but it's still O(all invoices). A Postgres RPC or materialized
  view that returns pre-aggregated totals would scale further; not
  built here since the trimmed query already resolves the actual
  complaint (page weight from the unused items join) and a
  hand-rolled aggregate view is a bigger, riskier change to get right
  than this stage's scope called for.
- **Virtualizing Customers/Inventory** — only the invoice list got
  windowed rendering. Paginating at 25 rows already keeps those two
  lists' DOM size small without needing virtualization on top.
- **Precached app-shell manifest for the service worker** — still the
  runtime cache-as-you-go strategy from Stage 9, for the same reason as
  before: Next.js's hashed bundle filenames make a static precache list
  go stale on every build.
- **Offline reads beyond the cached snapshot** — IndexedDB caching
  (§4) means the last-seen data stays visible while offline, but
  there's no offline *write* path added here beyond what the existing
  invoice-draft queue already did — you still can't, say, edit a
  customer's phone number while offline and have it queue.
