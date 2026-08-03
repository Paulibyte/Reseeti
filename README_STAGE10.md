# Reseeti — Stage 10: Inventory Automation

Automatic stock deduction on sale already existed (Stage 6's database
trigger). This stage adds the three pieces that were still manual: a real
distinction between "running low" and "actually out," profit calculation,
and a notice right when something sells out — not just a passive count you
have to go looking for.

## What's new

**1. Deduct stock — unchanged, already automatic.** No changes needed
here; flagging it so it's clear this stage builds on existing behavior
rather than re-solving it.

**2. Sharper low-stock warnings.** Previously "low stock" and "out of
stock" were the same bucket (`stock_qty <= threshold`). Now they're
distinct everywhere:
- **Inventory page** — two separate banners (out-of-stock in red, low-stock
  in amber), and each product row's badge says "Out of stock" instead of
  "0 in stock — low."
- **Invoice form** — selling an already-out-of-stock item shows a more
  urgent warning than merely selling more than what's left.
- **Notification bell** — out-of-stock and low-stock now show as two
  separate lines, out-of-stock listed first.

**3. Profit calculation.** New optional `cost_price` field on products
(Inventory → Add/Edit product). Analytics now shows a **Profit** stat card
with margin %, and the "Top selling items" list shows per-item profit
alongside revenue where cost data exists.

**Important design decision — cost is snapshotted at sale time, not looked
up live.** A new `cost_price_at_sale` column on `invoice_items` records
what a product cost *at the moment it was sold*, copied automatically by
the same database trigger that deducts stock. This means updating a
product's cost price today doesn't silently rewrite last month's profit
history — exactly the same reasoning as why the sale price itself is
stored on the invoice rather than looked up from the product each time.

**Profit only counts what it can actually calculate.** Items typed
freehand (not linked to inventory) and products with no cost price
entered simply don't contribute to the profit number — there's nothing to
subtract. The Profit stat card says "some items missing cost" when this
applies, rather than silently understating profit with no explanation.

**4. Stock-depletion notice at the moment of sale.** After saving an
invoice, if any item just sold took a product to zero, a dismissible
banner appears right on the dashboard: *"Bags of Cement just sold out.
Restock in Inventory when you can."* This is deliberately immediate —
the owner finds out at the point of sale, not days later scrolling
through Inventory.

## Setup

### 1. Run the migration
Supabase SQL editor → run `supabase/schema_stage10.sql` (after
`schema_stage9.sql`).

### 2. Install and run
No new dependencies:
```
npm install
npm run dev
```

### 3. Test the full loop
1. Go to **Inventory**, edit (or add) a product, and set both a **Price**
   and a **Cost price** — confirm the margin preview shows under the
   fields.
2. Set that product's stock to something small, like 2.
3. Create an invoice selling 2 of that product (mark it paid, or check
   back after marking it paid — profit is scoped to paid invoices, same
   as revenue).
4. Confirm the dashboard shows the "just sold out" banner immediately
   after saving.
5. Go to **Analytics** and confirm the **Profit** stat card shows a
   number, and the item appears with a profit line under "Top selling
   items."
6. Go back to **Inventory** and confirm that product now shows under the
   red "out of stock" banner, not the amber "running low" one.

## What's deliberately left out of this stage
- **No SMS/push notification for stock depletion** — it's an in-app
  banner only, seen the next time someone's looking at the dashboard.
  Consistent with the same scope decision made for staff invites in
  Stage 8 (no message-sending infrastructure added speculatively).
- **No automatic reorder suggestions** ("you usually restock 50 units when
  this happens") — the low-stock threshold is still just a static number
  the owner sets once. A smarter, sales-velocity-based suggestion is a
  reasonable future addition once there's enough sales history to make one
  meaningful.
- **Profit doesn't account for non-inventory costs** (rent, staff wages,
  delivery). This is *gross* profit on goods sold, not net business
  profit — worth being explicit about so it's not mistaken for the whole
  picture of how the business is doing.
