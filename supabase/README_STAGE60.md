# Stage 60 — Jobtins integration and two shop fixes

Jobtins is a separate shopping site that shows products from Reseeti shops.
Nothing is listed unless the business OWNER switches it on.

## Deploy order
1. Run `schema_stage60.sql` in the Supabase SQL editor first (safe to re-run).
   Every existing business starts switched OFF.
2. Then deploy the code.

## New files
- `supabase/schema_stage60.sql` — adds the opt-in flag (off for everyone).
- `app/api/catalogue/public/[slug]/route.js` — the read-only JSON feed Jobtins reads. Same rules as `/shop/<slug>` plus the owner's opt-in. Never exposes exact stock.
- `app/api/catalogue/jobtins/route.js` — owner-only on/off switch.

## Changed files (complete replacements of the previous versions)
- `app/dashboard/catalogue/page.js` — the "List on Jobtins" card.
- `app/dashboard/activity/page.js` — labels for listing/removing.
- `app/shop/[slug]/page.js` — **fix:** the page never asked for each product's `type`, so services (which have no stock count) showed as "Out of stock", greyed out, with no Add button. One line.
- `app/api/catalogue/checkout/route.js` — **fix:** the pay-online route now refuses sold-out items (409, with a message the shop page already displays) instead of letting a stale page take payment for them. Services are never sold out. The WhatsApp order route is deliberately unchanged: it only saves a record, and the customer's actual order is their WhatsApp message.

If you have edited any changed file since the last release, merge by hand
instead of replacing it; each change is small and is described above.

## Rules
- Only the owner can change the Jobtins switch (route checks the role; the database also lets only the owner update `businesses`).
- Turning ON needs: Pro plan, catalogue on, WhatsApp number set. Turning OFF is always allowed.
- Removal reaches Jobtins at its next sync.
- Both choices appear on the Activity page.
- The feed returns the same "unavailable" answer whether a shop has not opted in, is not Pro, or does not exist, so it never reveals which businesses exist.
- Ordering more than the stock is still allowed, as before; only items with no stock are refused.
