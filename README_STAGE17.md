# Reseeti — Stage 17: Email Invoice + Reporting Suite

Two features bundled together because the second reuses the first's PDF
generation.

## 1. Email Invoice

The receipt page (`/inv/{id}`) now has an **"✉ Email invoice"** button
below Download PDF / Share on WhatsApp. Click it, enter (or confirm) an
email address, and it sends the invoice as a PDF attachment plus a short
message with a link back to the online receipt.

**The PDF attached is generated the exact same way as "Download PDF"** —
both now call one shared function (`lib/generateInvoicePDF.js`) that
screenshots the rendered receipt and embeds it in a PDF. Before this
stage, "Download PDF" had its own copy of this logic; Email Invoice
reuses it instead of maintaining a second version that could quietly
drift out of visual sync with the receipt.

**If the customer has an email on file** (Stage 9's customer database),
it's prefilled automatically — otherwise the field starts blank.

### Why this endpoint checks a verification code, not a login
The receipt page has no login wall — same as WhatsApp share and PDF
download, by design, since a customer needs to open it without an
account. That means the email-sending API route is technically reachable
by ansyone with an invoice's URL. To stop that becoming "email arbitrary
addresses by guessing invoice ids," the request must include the
invoice's `verification_code` (the same one already shown on the receipt
and checked at `/verify/{code}` since Stage 14) — proof the caller
actually has this specific invoice open, not just a sequential ID.

### Setup — Resend
This uses [Resend](https://resend.com) via a direct REST call (no SDK
dependency added — same `fetch`-based pattern as the existing
Twilio/Paystack integrations). You need:

1. A Resend account and API key (resend.com/api-keys).
2. **A verified sending domain** (resend.com → Domains) — `RESEND_FROM_EMAIL`
   must be an address on that domain (e.g. `invoices@yourbusiness.com`).
   A plain Gmail/Yahoo address will not work; Resend won't send from a
   domain you haven't proven you own.
3. Add both to `.env.local`:
   ```
   RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
   RESEND_FROM_EMAIL=invoices@yourbusiness.com
   ```

(This file also fills in `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` /
`TWILIO_FROM_NUMBER` / `CRON_SECRET` in `.env.local.example` — those were
required by Stage 16's SMS reminders but had been left out of the
example file until now.)

## 2. Reporting Suite

**Reports** now has a report-type picker at the top. "Monthly Statement"
is the original report from before this stage, unchanged. Selecting any
of the other eight switches to a generic table view with a date-range
picker and three export buttons: **CSV, Excel, PDF**.

| Report | What it shows |
|---|---|
| Sales Report | Invoice count, invoiced, collected, outstanding — grouped by day/week/month/year (pick both the date range *and* the grouping, so "Daily/Weekly/Monthly/Yearly sales" are really one flexible report) |
| Product Sales | Units sold and revenue per product/item description |
| Customer Ranking | Customers ranked by total spend, with invoice count |
| Outstanding Debt | Unpaid invoices grouped by customer, with days overdue |
| Inventory Report | Current stock, price, stock value, and a low/out-of-stock flag per product (a snapshot, not date-ranged) |
| Profit Report | Gross profit per product — **uses the exact same computation as the Analytics page** (paid invoices only, items with a cost price only), so the two never disagree |
| Expense Report | Expenses grouped by category |
| Tax Report | Every invoice with VAT and/or withholding tax, itemized, with totals — meant for FIRS VAT remittance and WHT record-keeping |

Quick presets (Today / This week / This month / This year) set both the
date range and a sensible grouping in one click; the date inputs next to
them can be adjusted freely for a custom range.

### Why one generic table instead of eight bespoke ones
Every report type produces the same shape — `{ title, subtitle, columns,
rows, totals }` — via functions in `lib/reports.js`. The export code
(`lib/exportTable.js`) is written once against that shape and used by all
eight, rather than three export functions × eight reports = 24
near-duplicate implementations. Adding a ninth report type later means
writing one data function, not touching the export logic at all.

### The PDF export is a real table, not a screenshot
Report PDFs are drawn directly with jsPDF's text/line primitives — a
proper multi-page table with a repeating header row — rather than a
screenshot of the on-screen HTML (which is how the receipt PDF and the
Monthly Statement PDF both work). A data table's job is to be read and
possibly re-typed from, so it gets real selectable text instead of a
picture of text.

### Excel export
Uses the `xlsx` (SheetJS) library, added as a new dependency. Run
`npm install` after pulling this stage before `npm run dev`.

## Setup

### 1. Install dependencies
```
npm install
```
(adds `xlsx` for Excel export — no new Supabase migration this stage.)

### 2. Configure email
See the Resend setup above.

### 3. Test the full loop

**Email Invoice:**
1. Open any invoice's receipt page.
2. Click "✉ Email invoice," enter an email address, send.
3. Confirm the email arrives with the invoice PDF attached, and that the
   attached PDF looks identical to what "Download PDF" produces.
4. Try it again from a different browser tab with a made-up invoice id
   in the URL and no verification code — confirm the API rejects it.

**Reports:**
1. Go to Reports, switch the picker from "Monthly Statement" to "Sales
   Report." Try each of the four presets and confirm the grouping
   changes appropriately (Today → by day, This year → by month).
2. Switch to "Product Sales" and "Customer Ranking" — confirm the numbers
   match what Analytics shows for the same period.
3. Switch to "Profit Report" and compare its total against Analytics'
   "Gross profit" card for the same date range — they should match
   exactly, since both use the same computation.
4. Switch to "Tax Report" — confirm it only shows invoices that actually
   had VAT or WHT applied, and the totals match what Reports' Monthly
   Statement already shows as "VAT collected."
5. Try all three export buttons (CSV, Excel, PDF) on at least one report
   — open each downloaded file and confirm the numbers match the
   on-screen table.

## What's deliberately left out of this stage
- **No scheduled/automatic report emailing** (e.g. "email me the monthly
  statement on the 1st of every month") — Email Invoice is a manual,
  per-invoice action; a recurring digest would be a reasonable follow-up
  built on the same Resend integration plus Stage 16's cron pattern.
- **No report caching** — every report recomputes from the invoices/
  items/expenses already loaded client-side on page load, same approach
  the existing Monthly Statement and Analytics pages already use. Fine
  at the data volumes a small business accumulates; would need
  revisiting if a business's invoice history grew very large.
- **Tax Report covers VAT and WHT only** — it doesn't attempt to
  generate an actual FIRS filing document, just the itemized figures a
  business (or their accountant) needs to file one.
