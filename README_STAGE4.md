# Reseeti — Stage 4: Retention features

This stage adds the things that turn a one-time invoice tool into
something a business owner opens every week: knowing what's owed to them,
nudging customers who haven't paid, and putting their own branding on
every invoice.

## What's new

### 1. Dashboard summary
Three at-a-glance numbers at the top of the dashboard:
- **Owed to you** — sum of all unpaid invoice totals
- **Invoiced this month** — total value of invoices created this
  calendar month (paid or not)
- **Top customers** — the 3 customers with the highest total invoiced,
  useful for spotting who your best repeat buyers are

These are computed client-side from the invoices already loaded — no new
database calls, since the dashboard already fetches everything needed.

### 2. Payment reminders
Every unpaid invoice row now has a **Remind** button. Clicking it:
1. Opens WhatsApp with a pre-written reminder message including the
   invoice number, amount, and a link to the shareable invoice page
2. Records `last_reminded_at` on the invoice, so you can see (via the
   button's tooltip) when it was last nudged

This is intentionally **manual, not automated** — there's no cron job
silently texting customers on a schedule. That's a deliberate choice for
this stage: automated reminders sent without the business owner's
awareness can feel aggressive to customers and are harder to get right
(timing, frequency, tone). A "one tap when you're ready" reminder respects
that judgment call while still saving the owner from typing it out
manually each time.

### 3. Logo upload & branding
- **Business settings panel** (click "Edit" next to the business name)
  now lets you update name, phone, address, and upload a logo.
- Logos are stored in Supabase Storage in a public `logos` bucket, scoped
  so a business can only ever upload into its own folder
  (`logos/{business_id}/...`) — enforced by storage-level RLS, not just
  app code.
- The logo now appears both on the dashboard header and on every shared
  invoice page (`/inv/[id]`), including in the downloaded PDF.

## Setup

### 1. Run the migration
In the Supabase SQL editor, run `supabase/schema_stage4.sql`. This adds
the `last_reminded_at` column and creates the `logos` storage bucket with
its access policies.

### 2. No new environment variables needed.

### 3. Install and run as usual
```
npm install
npm run dev
```

## A note on the logo + PDF rendering
Downloading a PDF that includes an uploaded logo requires the browser to
load that image with CORS permissions enabled — Supabase's public storage
buckets serve images with permissive CORS by default, so this should work
out of the box. If a logo shows on-screen but doesn't appear in the
downloaded PDF, that's the first thing to check: open the browser console
while downloading and look for a CORS-related error on the image request.

## What's deliberately left out of this stage
- **Automated/scheduled reminders** (e.g. "auto-remind every 7 days") —
  a natural next step once you've seen how businesses actually use the
  manual version.
- **Logo resizing/cropping UI** — currently just displays whatever
  aspect ratio is uploaded, cropped to a square via CSS. Fine for an MVP;
  a proper crop tool is a nice-to-have once branding usage picks up.
- **Customer-level history view** — the "Top customers" list shows totals
  but doesn't yet link through to "all invoices for this customer." Worth
  adding if usage data shows people want it.

## Next: Stage 5
Offline-first behavior — caching the last-used business profile and
allowing draft invoices with no connection, syncing once back online —
and basic analytics to see where people drop off in the invoice-creation
flow.
