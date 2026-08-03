# Reseeti — Stage 6: CRM & Inventory

Two additions on top of the redesigned dashboard: real customer profiles
(not just data borrowed from invoice text fields), and product inventory
with automatic stock deduction on sale.

## CRM

**What changed:** customers used to be computed on the fly from whatever
name/phone was typed into an invoice. Now there's a real `customers` table
— profiles persist even before a first invoice exists, and carry fields an
invoice never had a place for: **notes** (e.g. "always pays via transfer,"
"prefers delivery after 4pm").

- **`/dashboard/customers`** — list view, now backed by real profiles.
  Add a customer directly, or one gets created automatically the next time
  you invoice a new phone number (see "How linking works" below).
- **`/dashboard/customers/[id]`** — profile page: outstanding balance,
  lifetime value, full purchase history (every invoice, clickable), and an
  editable notes field.
- **InvoiceForm** now autocompletes the customer name field against
  existing profiles (native `<datalist>`, so no extra library) and
  auto-fills their phone number when picked.

**How linking works, and a deliberate limitation:** a new invoice gets
linked to a customer profile by **phone number** — phone is the natural
dedupe key (there's a unique constraint on `customers(business_id,
phone)`). If a customer's phone number is entered and no matching profile
exists yet, one is created automatically. **If no phone number is given,
no profile gets linked** — a name alone isn't a reliable way to avoid
creating duplicate "Chinedu" profiles for different people. The invoice
still stores the typed customer name either way; it just won't show up
under a persisted profile without a phone number.

**Backward compatibility:** invoices created before this stage don't have
a `customer_id`. The customer list page still shows accurate stats for
them by falling back to matching on phone/name — but they won't appear
under a clickable profile until/unless a matching phone number links them
up naturally on a future invoice, or you add the customer manually and it
happens to match.

## Inventory

- **`/dashboard/inventory`** — product list: name, price, category,
  barcode, current stock, and a per-product low-stock threshold you set
  yourself (defaults to 5).
- **Low-stock alerts** — a banner at the top of the Inventory page lists
  what's running low, and the same count feeds into the notification bell
  on every dashboard page so it's visible even if you're not looking at
  Inventory specifically.
- **InvoiceForm** — the item description field is now a searchable picker
  (`<datalist>` again) against your product catalogue. Picking a product
  auto-fills its price and tags the line item so stock gets deducted; you
  can still type a completely free-text item for anything not tracked in
  inventory (e.g. a one-off service charge).
- A soft warning (not a hard block) appears if you invoice more of
  something than you currently have in stock — business owners sometimes
  legitimately sell ahead of a logged restock, so this doesn't stop you,
  it just flags it.

### On "barcode" specifically — a deliberate scope decision

This does **not** implement camera-based barcode scanning. What it does
instead: the barcode field is a plain text field you can type into, paste
into, or — critically — **a USB or Bluetooth barcode scanner just types
into it like a keyboard**, which is how most real-world point-of-sale
barcode scanners actually work; no camera or special integration needed.
The same field doubles as the Inventory page's search box, so scanning a
code there instantly finds the matching product.

Camera-based scanning (using the phone's own camera, via something like
the browser's `BarcodeDetector` API or a library like `html5-qrcode`) is a
reasonable Stage 7 addition if cheap handheld/Bluetooth scanners turn out
not to be common enough among actual users — flagging it here rather than
building it speculatively.

### How stock deduction actually works

This is implemented as a **Postgres trigger** (`deduct_stock_on_sale`,
see `schema_stage6.sql`), not application code. When any row is inserted
into `invoice_items` with a `product_id` set, the trigger decrements that
product's `stock_qty` by the sold quantity — automatically, at the
database level.

This matters because of the offline queue: invoices can be created by the
main form *or* synced later from `lib/offlineQueue.js`, and both paths
ultimately do the same `invoice_items` insert. Putting the deduction logic
in a trigger means it fires correctly either way, rather than needing to
remember to duplicate the deduction call in every code path that creates
an item — including ones added later.

**Known gap, flagged rather than solved:** there's no corresponding
restock-on-delete trigger, because invoices currently can't be deleted
from the UI at all. Worth adding in the same migration as a
delete-invoice feature, if one gets built — don't add the restock trigger
alone without the delete feature, since there'd be nothing to test it
against.

## Setup

### 1. Run the migration
Supabase SQL editor → run `supabase/schema_stage6.sql` (after
`schema_stage5.sql`).

### 2. Install and run
No new dependencies — just:
```
npm install
npm run dev
```

### 3. Test the full loop
1. Go to **Inventory**, add a product with a stock quantity (e.g. 10) and
   a barcode of your choosing.
2. Create a new invoice, and in the item field, start typing that
   product's name — confirm it appears in the autocomplete and picking it
   fills in the price.
3. Save the invoice, then go back to **Inventory** and confirm stock
   dropped by the quantity sold.
4. Lower a product's stock below its threshold (edit it directly) and
   confirm the low-stock banner and notification bell both pick it up.
5. Go to **Customers**, click into a profile, add a note, and confirm the
   purchase history shows the invoice from step 3.

## What's deliberately left out of this stage
- **Camera barcode scanning** — see the section above.
- **Multi-location / warehouse stock** — one stock number per product,
  not split across locations. Fine for a single shop; would need real
  rework for a business with more than one physical location.
- **Purchase orders / restocking workflow** — increasing stock currently
  means editing the product's quantity directly. A dedicated "Restock"
  action with its own history log is a reasonable next addition once you
  see how often stock actually gets replenished in practice.
- **Customer merge tool** — if a duplicate customer profile does slip
  through (e.g. two different phone formats for the same person), there's
  no UI yet to merge them. Worth building once it's an actual observed
  problem rather than a hypothetical one.
