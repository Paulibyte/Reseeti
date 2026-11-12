# Reseeti — Stage 65: the third marketplace is named Bulktins

The third marketplace switch (added in stage 63, named in stage 64) now carries its final name, **Bulktins**. The card on the **Catalogue** page reads **"List on Bulktins"**, and the **Activity** page records "Listed on Bulktins" and "Removed from Bulktins".

**Nothing about what a shop owner has chosen changes, and there is no SQL to run.** The switch keeps the same internal name (`foodmarket`) and the same two database columns (`foodmarket_opt_in`, `foodmarket_opt_in_at`), so every shop that had it on, and every shop that had it off, stays exactly as it was.

Activity entries recorded earlier keep the wording they were saved with ("Listed on Owerri Food Market" or "Listed on Foodtins"); new ones read "Bulktins". The stage 63 and 64 notes are left as they were, because they describe what those releases did at the time.

## Files

Changed: `lib/marketplaces.js` (the name and the sentence shown to owners), `app/dashboard/activity/page.js` (two labels), `app/api/catalogue/foodmarket/route.js` (a comment).
New: this note.

## Deploy

Pull, build and restart as usual. No database step.
