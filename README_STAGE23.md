# Reseeti — Stage 23: Analytics — heatmap, trends, conversion & repeat rate

Analytics (built out over several earlier stages) already covered a good
chunk of the target list — this stage fills in the four pieces that were
actually missing, plus deepens one that existed but only partially.

## Already there before this stage (no changes needed)
- **Revenue graph** — the "Revenue collected" bar chart.
- **Top products** — "Top selling items" card (revenue + profit where
  cost price is on record).
- **Top customers** — "Top customers" card (by total spend).
- **Average invoice value** — was already computed and shown under
  "Avg. invoice" in the Invoices stat group.

## New in this stage

### Sales heatmap
A day-of-week × time-of-day grid (`SalesHeatmap`, in
`app/dashboard/analytics/page.js`) — 7 rows (Monday-start, matching how
`startOfWeek()` already thinks about "this week" elsewhere on this page)
× six 4-hour buckets, so it stays readable on a phone without needing 24
individual hour columns. Cell shade = relative sales volume in that
slot, all-time. This is the concrete version of the AI Insight example
*"Most customers buy on Saturdays"* — a fixed, deterministic chart
rather than an AI-generated sentence, and it's bucketed by when each
invoice was **created** (i.e. when the sale happened), not when it was
paid, since payment can lag the actual transaction by days.

### Monthly trends (expanded)
The old single "Revenue collected — last 6 months" chart is now three
side-by-side mini charts under a "Monthly trends" heading: **Revenue**,
**Invoices issued**, and **Avg. invoice value** — each per month, last 6
months. Revenue trending flat while invoice count climbs (smaller
average sales) is a real pattern the old revenue-only chart couldn't
show; now it's visible at a glance across the three. `BarChart` picked
up a `formatValue` prop to support this — it previously always
formatted values as Naira, which doesn't make sense for an "invoices
issued" count.

### Conversion rate
New stat card, defined as **invoices paid ÷ invoices issued**. Reseeti
has no separate quote/estimate step, so there's no other meaningful
"conversion" moment to measure — this reuses the paid-rate figure that
already existed (it was previously only shown as a small sub-label
under "Avg. invoice"), now promoted to its own labeled metric since it
was explicitly asked for as one.

### Repeat customer percentage
New stat card: what fraction of a business's *entire* customer list has
bought more than once — not just the top 5 shown in the "Top customers"
card. Needed a new aggregation (`customerStats`) built over every
invoice's customer, since the existing top-customers logic only ever
kept the top 5 and threw the rest away.

## Setup

No migration, no new dependencies — everything here is computed from
data already being fetched by this page (`invoices`, `items`,
`expenses`).

### Test it
1. Open `/dashboard/analytics` on a business with a reasonable spread of
   invoices across different days/times and a few repeat customers.
2. **Conversion & customers** section: confirm Conversion rate matches
   (paid invoices ÷ total invoices), and Repeat customers matches
   (customers with 2+ invoices ÷ total unique customers).
3. **Monthly trends**: confirm all three mini charts line up
   month-for-month (same 6 months, same highlighted "current month" bar
   in orange).
4. **Sales heatmap**: create a couple of test invoices and confirm the
   corresponding day/time cell darkens; hover a cell to see its exact
   count in the tooltip. Confirm the "Busiest slot" caption matches the
   darkest cell's day.
5. Confirm the empty-state ("No data yet") still shows correctly for a
   brand-new business with zero invoices — none of the new sections
   should render (or error) before there's any data.

## What's deliberately left out of this stage

- **Hour-level (rather than 4-hour-bucket) heatmap resolution** — 24
  individual hour columns would either force horizontal scrolling on
  mobile or shrink each cell to the point of being unreadable/untappable
  for its tooltip. Six 4-hour buckets was the tradeoff that kept it
  usable on a phone; a business that specifically needs hour-level
  granularity could get that from Reports' raw export instead.
- **A selectable date range for Monthly trends** (3/6/12 months) — fixed
  at 6 months, matching what the Revenue chart already used before this
  stage. A range picker is a reasonable follow-up if 6 months turns out
  to be too short for some businesses' planning needs.
- **Server-side aggregation for the heatmap/trends math** — same
  tradeoff noted in Stage 19 and Stage 22's READMEs: this page still
  fetches all of a business's invoices/items and reduces them in the
  browser. Fine at the data volumes a small business actually has; the
  first thing to revisit if this page ever needs to handle years of
  history for a much larger business.
