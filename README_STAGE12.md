# Reseeti — Stage 12: Expense Tracking

Fuel, transport, salary, shop rent, electricity, internet — plus a catch-all
"Other" — logged against the business, and factored into a real
**Net profit = Sales − Expenses** figure on Analytics and in the monthly
Reports statement. This is the stage that turns Reseeti from an invoicing
log into an actual (small) accounting system.

## Where it shows up

**New: Expenses page** (sidebar, right after Inventory) — log an expense
with a category, amount, date, and an optional note (required for
"Other," since that category needs *some* explanation to be useful later).
Filterable by month, with a running total and a per-category breakdown for
the selected month.

**Analytics** — a new "Profit & expenses" section above the existing
Highlights, with three numbers:
- **Net profit** — the literal `Sales − Expenses` figure, the headline
  number
- **Total expenses** — all-time
- **Gross profit** — this is the profit metric from Stage 10 (revenue
  minus cost-of-goods-sold on inventory items), relabeled "Gross profit"
  now that there's a second, more complete profit number to distinguish
  it from. See "Two different profit numbers" below.

Also new: an "Expenses by category" panel alongside the existing Top
customers / Top selling items panels.

**Reports** — the monthly statement now includes Expenses and Net profit
in its summary row, a full expenses table underneath the invoices table,
and the CSV export includes an EXPENSES section with its own subtotal and
a final NET PROFIT line.

## Two different profit numbers — worth understanding, not just picking one

This app now shows **two** profit figures, and they answer different
questions:

- **Gross profit** (Stage 10): `Revenue − cost of goods sold`. Only
  accounts for what inventory items cost to acquire (their `cost_price`).
  Doesn't know about rent, salaries, fuel, or anything else.
- **Net profit** (this stage): `Revenue − all logged expenses`. This is
  the number that actually answers "am I making money" for a real
  business, since it includes operating costs.

**What's not built, and worth being upfront about:** a true, fully
correct bottom line would be `Revenue − COGS − Operating Expenses`
combined. Right now Net Profit only subtracts logged Expenses, not COGS —
so if a business tracks both cost prices on products *and* logs expenses,
Net Profit as shown slightly overstates the true bottom line (it's not
double-subtracting COGS, but it's also not subtracting it at all). This is
a reasonable v1 scope match to what was asked for (`Profit = Sales −
Expenses`, literally), but flagging it clearly rather than quietly
shipping a number that looks more authoritative than it is. A combined
"true net profit" figure is a natural next addition once this is in use.

## Setup

### 1. Run the migration
Supabase SQL editor → run `supabase/schema_stage12.sql` (after
`schema_stage11.sql`).

### 2. Install and run
No new dependencies:
```
npm install
npm run dev
```

### 3. Test the full loop
1. Go to **Expenses**, log a few across different categories (e.g. Fuel
   ₦5,000, Shop rent ₦50,000).
2. Confirm the month total and per-category breakdown update.
3. Go to **Analytics** — confirm Net Profit reflects `Sales − Expenses`,
   and the new "Expenses by category" panel shows what you logged.
4. Go to **Reports**, pick the same month, and confirm both the Expenses
   total and Net Profit appear in the statement summary, with a full
   expenses table below the invoices.
5. Download the CSV and confirm it has an EXPENSES section with its own
   subtotal and a final NET PROFIT line.

## Permissions
Expenses follow the same access pattern as customers, products, and
invoices (Stage 8): any active team member — owner or staff — can log,
edit, or delete expenses. This is deliberate: a staff member who buys
fuel or pays a delivery rider needs to be able to record it themselves
without routing through the owner every time.

## What's deliberately left out of this stage
- **No receipt/photo attachment** per expense — just category, amount,
  date, and a text note. Useful future addition (Supabase Storage,
  following the same pattern as the logo upload) once it's clear people
  want it.
- **No recurring expenses** (e.g. auto-logging rent every month). Each
  entry is logged manually. Worth adding once there's a sense of which
  expenses are actually recurring often enough to justify the extra
  complexity.
- **No combined Gross + Net profit into one true bottom-line number** —
  see "Two different profit numbers" above.
- **No expense approval workflow** for staff-logged expenses — anything a
  staff member logs is immediately real, no owner review step. Fine for
  small teams with trust already established; would need rework for
  anything larger.
