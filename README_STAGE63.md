# Reseeti — Stage 63: selling in bulk, and a third marketplace switch

## What it does

**1. Bulk selling.** A product can now be sold by the bag, carton or crate with a minimum order and cheaper prices for larger quantities. In **Inventory → Add/Edit product** there is a new box, **How do you sell this?**:

- **Retail only** (the default, and what every existing product stays): one price, any quantity. Nothing changes.
- **Wholesale only:** a **smallest order** (for example 5 cartons) and, if you like, up to 4 **bulk prices** ("from 20 cartons, ₦50,000 each").
- **Retail and wholesale:** anyone can buy one at the normal price, and larger quantities earn the bulk price.

A bulk price applies to the **whole** order once its quantity is reached (20 cartons all cost ₦50,000 each, not just the 20th). Because that means ordering a little more can cost less in total, the form tells you when a price does that, so it is never a surprise. It is a note, not a refusal.

On the shop page customers see "from ₦56,500 in bulk" and "Min. 5" on the product, the full price list and the date the price last changed when they open it, a cart that adds up correctly, and a short hint when they are close to a cheaper price ("Add 4 more … to pay ₦58,000 each").

**2. Price date.** Each product records when its price (or a bulk price) last changed, and shows it to buyers. Food prices move often, and a dated price is one buyers trust. Renaming a product or saving it unchanged does not move the date. Products that already exist show no date until their price next changes (nothing is guessed, and running the SQL does not touch any product row).

**3. A third marketplace switch, "List on Owerri Food Market"**, beside Jobtins and HomeEase Nigeria. Same rules as before: it is OFF for every business, including those already on the others, until the owner chooses, and the three choices never affect each other.

## Run order

1. **Supabase SQL editor:** run `supabase/schema_stage63.sql` (after stage 62). Safe to run again.
2. **Deploy the app** (pull, build, restart).

The two can be done in either order. Until the SQL is run, shops and checkout keep working exactly as before (the new columns are only requested if they exist), the bulk-selling box can be seen in the form, and trying to save a product **with** bulk prices will fail with a database message; products saved as retail work normally. So run the SQL first, then deploy.

## How the price is decided (important)

One set of rules (`lib/wholesalePricing.js`) is used by the form (to check what you enter), the shop page (what a customer sees and what their cart adds up to) and both order routes. The **server decides every price** from the database: the checkout and the WhatsApp order record read the product, work out the unit price for that quantity, and ignore any price, minimum or bulk price sent by the page. The checkout also **refuses an order below a product's minimum** with a clear message, before any order or payment exists.

Limits: a minimum or a bulk-price quantity can be at most 1,000 (the order routes accept at most 1,000 of one item).

## Not changed (on purpose)

- The point-of-sale and invoice screens still price by the normal price; staff can edit a line price as before. Bulk prices apply to the online shop.
- Stock quantity is still not checked against the quantity ordered (it never was). A shop can be sent an order for more than it holds. This matters more for bulk orders, so it is worth a decision of its own.

## Files

New: `supabase/schema_stage63.sql`, `lib/wholesalePricing.js`, `app/api/catalogue/foodmarket/route.js`.
Changed: `lib/catalogueProducts.js` (now copes with each optional group of columns being missing on its own), `lib/marketplaces.js`, `app/api/catalogue/checkout/route.js`, `app/api/catalogue/orders/route.js`, `app/api/catalogue/public/[slug]/route.js` (the feed now carries `sale_mode`, `moq`, `price_tiers`, `price_updated_at`), `app/dashboard/activity/page.js`, `app/dashboard/inventory/ProductForm.jsx`, `app/shop/[slug]/ShopCart.jsx`.

## Tests

Kept with the Jobtins project, which runs these real files: the pricing rules at every boundary, the database change, both order routes (including tampering and a database that has not been updated), the feed, the product loader, the product form and the shop page in a real browser, and the third marketplace's route, feed and Catalogue card. Each of the money paths was also broken on purpose to confirm the tests notice.
