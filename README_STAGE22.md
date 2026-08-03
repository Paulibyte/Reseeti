# Reseeti — Stage 22: AI Features

Three AI features, all backed by the Claude API, all following the same
rule: **the AI fills in a form, a human still hits Save.** Nothing in
this stage writes to the database on its own — every route returns
structured suggestions that a page pre-fills, and the business owner (or
whoever's on the till) reviews before anything becomes a real invoice,
expense, or figure they act on. That's not a style choice, it's the
actual safety property this stage depends on: a misheard product name or
a misread receipt amount is real money if nobody catches it, so nothing
here is allowed to skip the review step.

All three share `lib/anthropic.js` (server-only — the API key never
reaches the browser) and use `claude-haiku-4-5-20251001` for the two
narrow extraction tasks, `claude-sonnet-5` for the one that needs real
reasoning (Business Insights). See that file for the reasoning on the
model split.

## 1. AI Invoice Assistant

Type a plain sentence — *"Sold 2 bags of rice and one carton of milk"*
— into a new box at the top of the invoice form
(`app/dashboard/InvoiceForm.jsx`), click **Fill in**, and it replaces
the item rows with what it understood.

`app/api/ai/parse-invoice/route.js` sends the sentence to Claude
alongside the business's actual product catalog (name, price, stock —
scoped to that business only) and asks it to:
- match each mentioned item to a real product where it's reasonably
  confident (handling plurals, minor spelling differences, etc.) and use
  that product's real price — never a guessed one;
- for anything that doesn't clearly match, still add it as a line item,
  but with `matched: false` and **no price** — InvoiceForm leaves that
  row's price field empty rather than inventing a number;
- flag a warning if the requested quantity would exceed what's in
  stock;
- optionally pick out a customer name if one was mentioned ("for John…").

This replaces whatever's currently in the item rows rather than
appending — it's meant as a fast starting draft for a fresh invoice, not
a way to bolt more items onto one already being hand-edited.

## 2. AI Business Insights

A new card on the dashboard home (`app/dashboard/AiInsights.jsx`), shown
to anyone with the `viewAnalytics` permission (Owner/Manager/Accountant
— the same roles that already see the Analytics page). Click **Generate
insights** and it produces 3-5 short, specific lines like the examples
in the brief — *"Sales are down 23% vs the prior 30 days," "Rice is your
best-selling product," "Cement may run out in about 4 days at the
current rate."*

`app/api/ai/insights/route.js` does the actual work in two steps:
1. **Aggregates first, in plain JS** — last-30-vs-prior-30-day revenue,
   invoice counts, day-of-week distribution, low-stock products, expense
   totals by category, repeat-customer count. Claude is good at spotting
   a pattern in numbers handed to it; it's not asked to do the counting
   itself, and the aggregation step never sends raw invoice/customer rows
   to the API — only bounded sums and counts, no names or phone numbers.
2. **Hands that summary to Claude** with instructions to write concrete,
   numbers-backed observations and never claim a figure it wasn't given.

Results are **cached** on the business (`businesses.ai_insights` /
`ai_insights_generated_at`) for 24 hours — GET returns the cache
instantly with no API call; POST (the Generate/Refresh button) is the
only thing that actually costs a Claude call. A business's numbers don't
meaningfully change minute-to-minute, and every generation is a real
cost, so this is never triggered automatically on page load. Needs at
least 5 invoices in the last 90 days before it'll generate anything —
returns a plain "not enough history yet" message below that, rather
than asking Claude to find patterns in almost no data.

## 3. AI Expense Categorization

On the "Log an expense" form (`app/dashboard/expenses/page.js`, new-expense
only — not shown when editing an existing one), a **"📷 Scan a receipt
with AI"** button opens the camera/file picker. The photo is sent
straight to `app/api/ai/extract-receipt/route.js` as base64 (capped at
5MB client-side, 8MB server-side) — never uploaded to Supabase Storage
or persisted anywhere; it's read once for extraction and then discarded.

Claude (with vision — all current models support image input) reads the
receipt and returns `{ vendor, amount, date, category, confidence }`,
mapped onto one of the app's existing expense categories
(`fuel`/`transport`/`salary`/`rent`/`electricity`/`internet`/`other`).
Those four fields pre-fill the form; a banner tells you whether it read
cleanly or with low confidence, and if the amount genuinely wasn't
legible, that field is left blank rather than filled with a guess. A
new `expenses.vendor` column (schema_stage22.sql) holds the vendor name,
shown on the expense list alongside the category and description.

## Setup

### 1. Get an Anthropic API key
console.anthropic.com → Settings → API Keys. Add it to `.env.local`:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Server-only — never referenced from any `'use client'` file, only from
`app/api/ai/*/route.js` handlers via `lib/anthropic.js`.

### 2. Run the migration
Supabase SQL editor → run `supabase/schema_stage22.sql` (after whichever
stage you're currently on). Adds `businesses.ai_insights` /
`ai_insights_generated_at` (the insights cache) and `expenses.vendor` —
no data changes, safe to run any time.

### 3. Test each feature
1. **Invoice Assistant**: open "+ Create Invoice," type a sale
   description that mentions at least one real product in your
   inventory and one made-up item, click Fill in. Confirm the real
   product gets its actual price and the made-up one comes back with an
   empty, reviewable price field.
2. **Business Insights**: need at least 5 invoices in the last 90 days
   first. Click "Generate insights" on the dashboard, confirm you get a
   short list of specific, numbers-backed lines (not generic advice).
   Reload the page — confirm it shows the cached result instantly
   without regenerating. Click Refresh to force a new generation.
3. **Expense Categorization**: click "Log expense" → "Scan a receipt
   with AI," upload a photo of any real or sample receipt. Confirm
   vendor/amount/date/category pre-fill, and that you still have to
   click "Log expense" to actually save it — nothing should save
   automatically.

## What's deliberately left out of this stage

- **Auto-saving anything the AI produces** — covered above, but worth
  restating as the central design decision of this whole stage: every
  one of the three features stops at "here's a filled-in form," never
  "here's a saved record."
- **Persisting uploaded receipt photos** — Expense Categorization reads
  the image once and discards it; it's not stored in Supabase Storage or
  attached to the expense record. If receipt photos as permanent
  attachments turns out to matter (audit trail, tax records), that's a
  reasonable follow-up, but it's a distinct feature (storage bucket,
  policies, a way to view them later) from "extract four fields."
- **A monthly AI usage cap or per-business rate limit** — every route
  simply calls the Claude API and returns the result; there's no
  spend-tracking or throttling beyond the 24-hour insights cache. Worth
  adding once real usage patterns are known, but guessing at a limit now
  risks being wrong in either direction.
- **Rewriting Business Insights' aggregation as a Postgres RPC/view** —
  the 90-day aggregation currently happens in the API route after three
  plain `select` calls. That's fine at the row counts a small business
  actually has; if this route ever needs to scale to businesses with
  years of history, moving the aggregation server-side (SQL) rather than
  fetching-then-reducing in JS would be the next step — same tradeoff
  Stage 19's README noted for the dashboard's own stat cards.
- **Multi-language input for the Invoice Assistant** — the examples in
  the brief are English; Claude will likely handle Pidgin or mixed-language
  input reasonably well already, but that wasn't specifically tested or
  tuned for in this stage's prompt.
