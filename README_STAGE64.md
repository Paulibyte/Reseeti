# Reseeti — Stage 64: the third marketplace is named Foodtins

Stage 63 added a third marketplace switch under a working name, "Owerri Food Market". Its real name is **Foodtins**, so the card on the **Catalogue** page now reads **"List on Foodtins"**, and the **Activity** page records "Listed on Foodtins" and "Removed from Foodtins".

**Nothing about what a shop owner has chosen changes.** The switch keeps the same internal name (`foodmarket`) and the same two database columns (`foodmarket_opt_in`, `foodmarket_opt_in_at`), so every shop that had it on, and every shop that had it off, stays exactly as it was. **There is no SQL to run.**

Earlier Activity entries that were recorded as "Listed on Owerri Food Market" keep their own wording in the shop's history; new ones read "Foodtins".

## Files

Changed: `lib/marketplaces.js` (the name and the sentence shown to owners), `app/dashboard/activity/page.js` (two labels), `app/api/catalogue/foodmarket/route.js` (a comment).
New: this note.

## Deploy

Pull, build and restart as usual. No database step.
