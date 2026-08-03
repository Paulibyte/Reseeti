# Reseeti — Stage 15: POS Sales, VAT Support, Naira Formatting

Three related pieces, bundled together because the payment and tax
features both touch the same invoice math, and the formatting sweep
touches nearly every file the other two changes also touch.

## 1. POS-style payment recording + split payments

**Mark Paid** (Dashboard → invoice list → mark an unpaid invoice paid)
now offers five real payment methods instead of the old four generic
ones: **Cash, Transfer, POS, Card, USSD** (plus Other as a catch-all).

**Split payments** — click "Split across multiple payment methods" to
record a sale paid partly one way and partly another (e.g. ₦5,000 cash +
₦3,000 transfer). Each row is a method + amount; the modal shows how much
of the total is still unaccounted for, and won't let you confirm until
the rows add up to the exact invoice total.

Under the hood: a new `invoice_payments` table holds the actual
breakdown (one row per method used). `invoices.payment_method` stays a
quick-glance summary column — the single method name, or `'split'` when
more than one was used — so anywhere that just needs "how was this
paid" at a glance doesn't need to join another table.

The receipt (`/inv/{id}`) shows the full breakdown when a payment was
split, instead of a single "Paid via ___" line.

## 2. VAT, Service charge, Shipping, Withholding tax

**Business Settings** has a new "Taxes & charges" section — toggle
each on/off and set a default rate. These prefill every new invoice,
which can still override before saving.

**On the invoice form**, when enabled, each shows as its own line with
its rate, and the full breakdown (Subtotal → Discount → Service charge →
VAT → Shipping → Withholding tax → Total) is now always visible while
creating an invoice, not just a bare Total.

**The math**, in order:
```
Net subtotal      = Subtotal − Discount
Service charge    = Net subtotal × service charge rate%
VAT               = (Net subtotal + Service charge) × VAT rate%   ← FIRS VAT base includes service charge
Shipping          = flat amount, added after VAT (not VATable)
Withholding tax    = Net subtotal × WHT rate%                      ← deducted, not added
Total             = Net subtotal + Service charge + VAT + Shipping − Withholding tax
```
Withholding tax is the odd one out — it's a **deduction** from the
amount payable, not a charge to the customer. It's mainly relevant if
you invoice corporate clients who withhold tax at source before paying
you, which is why it defaults off.

Each invoice stores both the rate used and the resulting amount, so
existing invoices don't change retroactively if a business's default
rate changes later.

**Reports** now also shows a "VAT collected" figure for the month
(useful for FIRS remittance) whenever any invoice in that period had VAT
applied, both on-screen and in the CSV export.

## 3. Naira formatting, made actually consistent

Before this stage, seven different files each had their own copy of a
`money()` formatting function. Six of them matched; the seventh
(`ReceiptClient.jsx`, the actual customer-facing receipt) was missing
`maximumFractionDigits: 0`, meaning a value with floating-point noise —
easy to get from `qty × price` arithmetic — could print as something
like `₦1,250.000000001` on the receipt while every other page showed
`₦1,250`. There were also a handful of spots (dashboard stat cards, the
customer profile page, the inventory list) that formatted currency
inline with `₦${x.toLocaleString()}` — no locale, no fraction-digit cap
— which is where a plain "1250" with no comma or symbol could slip
through in edge cases too.

Fixed by introducing **`lib/format.js`** — one `formatNaira()` function,
imported everywhere currency is displayed. No more local copies, no
more drift between pages.

## Setup

### 1. Run the migration
Supabase SQL editor → run `supabase/schema_stage15.sql` (after
`schema_stage14.sql`).

### 2. Install and run
No new dependencies:
```
npm install
npm run dev
```

### 3. Test the full loop
1. In **Business Settings**, turn on VAT (leave at 7.5%) and Service
   charge (try 10%). Save.
2. Create a new invoice — confirm both show up pre-checked with those
   rates, and the breakdown (Subtotal → Service charge → VAT → Total)
   updates live as you edit items.
3. Add a shipping fee and confirm it's added after VAT, not before.
4. Save the invoice, then mark it paid — try a normal single method
   first (e.g. Transfer), confirm the receipt shows "Paid via Transfer."
5. Mark a second invoice paid using "Split across multiple payment
   methods" — add Cash + POS rows that sum to the total, confirm it
   won't let you submit until they match, then confirm the receipt shows
   both lines.
6. Check **Reports** for the month — confirm "VAT collected" appears and
   matches what you'd expect, and shows up in the downloaded CSV too.
7. Spot check formatting: Dashboard stat cards, Inventory prices,
   Cashbook balance, Expenses totals, a customer's profile page, and the
   receipt itself should all show amounts the same way — `₦` symbol,
   comma-grouped, no stray decimals.

## What's deliberately left out of this stage
- **No automatic Cashbook entry from a cash payment.** Marking an
  invoice paid via Cash doesn't auto-log a Cash In entry in Stage 13's
  Cashbook — that was flagged as a natural follow-up in the Stage 13
  README, and is still a reasonable next addition, but keeping this
  stage's scope to payment recording + tax math rather than also wiring
  up cross-feature automation.
- **No VAT/WHT registration number fields** (a business's actual TIN,
  or a customer's tax ID being cross-referenced for WHT purposes) — the
  Stage 9 customer database already has a Tax ID field per customer,
  usable for a business's own records, but nothing here validates or
  requires it.
- **No overpayment/change handling** in Mark Paid — split payments must
  sum to exactly the invoice total; there's no "customer paid ₦10,000
  cash for a ₦8,500 bill, log ₦1,500 change" flow.
