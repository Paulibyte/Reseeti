# Reseeti — Stage 62: a second marketplace, "List on HomeEase Nigeria"

HomeEase Nigeria is another shopping site, like Jobtins, that shows products from Reseeti shops. **Each marketplace is a separate choice by the shop's owner.** Agreeing to appear on Jobtins is not agreeing to appear on HomeEase Nigeria, and every shop starts OFF for the new one, including every shop already on Jobtins.

## Run order (important)

1. **Supabase:** run `supabase/schema_stage62.sql` in the SQL editor (after stage 61). Safe to run again.
2. **Deploy the app** (pull, build, restart).

Deploy in either order and nothing breaks: the HomeEase card appears on the Catalogue page only once the database has its column, and Jobtins' feed never asks for that column.

## What an owner sees

On **Catalogue**, a second card beside "List on Jobtins": **List on HomeEase Nigeria**, with its own button, its own "Listed" badge, and its own "What HomeEase Nigeria can and can't see" note. Only the owner can change it, and it needs the same things as Jobtins (Pro plan, catalogue on, a WhatsApp number). Turning it off is always allowed. The two switches never affect each other. The Activity page records each choice separately ("Listed on HomeEase Nigeria", "Removed from HomeEase Nigeria").

## How the feed works now

`/api/catalogue/public/<slug>` answers **the marketplace that is asking**:

- `?market=homeease` is answered only for shops that switched on HomeEase Nigeria.
- `?market=jobtins`, **or no `market` at all** (every Jobtins before HomeEase existed), is answered only for shops that switched on Jobtins, exactly as before.
- A marketplace name we do not know is refused (404) before the database is asked.
- A refusal always looks the same ("unavailable"), so it never says whether a shop exists or why it is missing.
- Each marketplace has its own request allowance (300 per 10 minutes), so one syncing a lot of shops never uses up another's. (Both run on the same server.)
- The feed itself is identical whichever marketplace asks: the same fields, nothing private (no customers, invoices, costs or exact stock).

The database is only asked for the asking marketplace's column, so **Jobtins keeps working before this stage's SQL is run**.

## Adding another marketplace later

All of it is in `lib/marketplaces.js`: add the entry, add its two columns in a new `schema_stageNN.sql`, add a route that calls `setMarketplaceOptIn` (copy `app/api/catalogue/homeease/route.js`), and add its two Activity labels. The Catalogue page draws a card for every entry whose column exists.

## Files

New: `supabase/schema_stage62.sql`, `lib/marketplaces.js`, `app/api/catalogue/marketplaceOptIn.js`, `app/api/catalogue/homeease/route.js`.
Changed: `app/api/catalogue/jobtins/route.js` (now a few lines: same rules, shared), `app/api/catalogue/public/[slug]/route.js`, `app/dashboard/catalogue/page.js`, `app/dashboard/activity/page.js`.

Because stage 61 (several photos) changed two of these files too, the versions in this stage include both stages' changes.

## Tests

Kept with the Jobtins project, which drives these real files: the database change (and that Jobtins choices are untouched), both routes (including that neither writes the other's column), the feed for every combination of opt-ins, the cards on the Catalogue page, and the Activity labels. The 40 existing Jobtins opt-in and feed tests pass unchanged.
