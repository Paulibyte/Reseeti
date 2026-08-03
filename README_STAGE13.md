# Reseeti — Stage 13: Cashbook

A running ledger of **Cash In**, **Cash Out**, and **Balance** — the exact
format most Nigerian traders already keep by hand in an exercise book,
now digital and auto-totaled instead of hand-added at the end of each day.

## What's new

**New: Cashbook page** (sidebar, right after Expenses).

- **+ Cash In** / **+ Cash Out** — two big, obvious buttons. Each entry is
  just an amount, an optional description ("Cash sale," "Supplier
  payment," "Transport"), and a date.
- **Balance** card at the top — the actual cash-on-hand figure right now:
  opening balance plus every Cash In, minus every Cash Out, all-time. This
  is the number a trader checks first thing, so it's the biggest number on
  the page.
- **Cash In this month** / **Cash Out this month** — the flow, filterable
  by month like Expenses.
- A ledger table below, newest entry first, with a running **Balance**
  column per row — so you can see not just what happened, but what your
  cash position was at that exact moment.
- **Opening balance** — a one-time "how much cash did you have before you
  started using this" figure, editable by the owner only (Set opening
  balance link under the Balance card).

## Why Cashbook is its own ledger, not derived from Sales/Expenses

This was the main design decision. Reseeti already has invoices (marked
paid or not) and Expenses (Stage 12) — both of which sound related to
"cash in" and "cash out." But:

- Not every paid invoice is a **cash** payment — some are bank transfer,
  card, or (once Payments/subscriptions are involved) online gateway.
- Not every expense is paid in **cash** either.

Auto-populating Cashbook from either would silently blend cash and
non-cash movements into a figure that's supposed to answer one very
literal, very physical question: *"how many naira notes do I actually
have in the drawer right now?"* That question deserves its own explicit
ledger where every entry is a deliberate cash movement, not an inference.
This is the same scope reasoning Stage 12 used for Expenses not
auto-linking to Sales.

The tradeoff is manual entry — mitigated by keeping it to two taps (Cash
In / Cash Out) and an amount, same speed as writing a line in a paper
cashbook.

## Setup

### 1. Run the migration
Supabase SQL editor → run `supabase/schema_stage13.sql` (after
`schema_stage12.sql`).

### 2. Install and run
No new dependencies:
```
npm install
npm run dev
```

### 3. Test the full loop
1. Go to **Cashbook** as the business owner. Click "Set opening balance"
   and enter whatever cash is on hand right now (or leave at 0 for a
   fresh business).
2. Click **+ Cash In**, log a cash sale, e.g. ₦5,000.
3. Click **+ Cash Out**, log an expense paid in cash, e.g. ₦1,500
   transport.
4. Confirm the **Balance** card updates to opening balance + 5,000 − 1,500,
   and the ledger table shows both entries with the correct running
   balance per row.
5. Switch the month filter to a past month with no entries — confirm the
   Balance card at the top stays the same (it's always all-time), while
   the "this month" totals and table go empty.
6. Log in as a staff account and confirm "Set opening balance" isn't
   visible to them, but they can still add Cash In / Cash Out entries.

## Permissions
Logging Cash In / Cash Out follows the same pattern as Expenses (Stage
12) — any active team member can add, edit, or delete entries. **Opening
balance is owner-only**, since changing it retroactively shifts every
running balance in the ledger — a much quieter way to paper over a
shortfall than any single entry would be.

## What's deliberately left out of this stage
- **No auto-suggested entries from paid invoices or logged expenses** —
  see the reasoning above. A future addition could offer a one-tap
  "also log as Cash In" prompt right when marking an invoice paid, but
  only for invoices explicitly marked as a cash payment (which would
  itself need a payment-method field that doesn't exist yet).
- **No daily open/close snapshot** — the running balance already carries
  forward continuously, so there's no separate "closing balance" to
  reconcile each night; today's opening is simply yesterday's last
  running balance.
- **No cash reconciliation / discrepancy flagging** (comparing a manual
  physical count against the ledger balance and flagging a mismatch) —
  a reasonable next step once Cashbook is in daily use.
