# Reseeti — Stage 61: several photos per product

Some things people sell cannot be shown well with one picture: cars, property, furniture, a wedding dress. A product can now have **up to 8 photos**, switched on for the items that need them.

## Run order (important)

1. **Supabase:** run `supabase/schema_stage61.sql` in the SQL editor. Safe to run again.
2. **Deploy the app** (pull, build, restart).

Do them in that order. If the app is deployed first it still works (see "If the database update has not been run yet"), but several photos cannot be saved until the SQL is run.

## How a business uses it

In **Inventory → Add product / Edit**, for a Pro business, the photo section has a switch: **"This item needs several photos (cars, property, furniture…)"**.

- **Off** (the default): one photo, exactly as before.
- **On**: a gallery. **Add photos** takes several files at once. Each photo has ◀ ▶ to move it, **Make cover** and ✕ to remove it. The first photo is the **cover**: the one shown on the shop page grid and in Jobtins listings.
- An item that already has several photos opens with the switch on. Switching it off asks first, and keeps only the cover.
- Big phone photos are **shrunk automatically** in the browser (to 1600 pixels, as a JPEG) before upload, so a 6 MB camera photo no longer hits the upload limit. GIFs are not changed. Each photo must still end up under the admin's upload limit (2 MB by default).
- The inventory list shows a small number on the thumbnail when an item has more than one photo.

## What customers see

- **Shop page** (`/shop/<slug>`): a card with several photos shows a small "📷 3". Opening the item shows a gallery: arrows, a row of small pictures, a count ("2 / 5"), the arrow keys and swiping.
- **Jobtins**: shows the same gallery on the item's page (needs Jobtins migration 007 and its refresh).

## How it is stored

- `products.photos` (jsonb): the ordered list of photo web addresses, never more than 8.
- `products.photo_url` is **kept and always equals the first photo** (a database rule, `sync_product_photos`, makes sure). So everything that reads one photo (Jobtins before it was upgraded, older copies of this app open in a browser tab) keeps working. If an older copy changes only `photo_url`, it replaces the first photo and the others are kept.
- New photos are stored in the existing `logos` bucket at `{business_id}/products/{product_id}/{random}.jpg`. This is inside the folder the existing storage rules already allow (`schema_stage44.sql`), so **no storage changes are needed**. Each photo has its own name, so one never overwrites another and a browser never shows an old picture from its cache.
- A photo taken off an item has its file deleted too, but only if it is one of that business's own product photos in our bucket (`storagePathFor` in `lib/productPhotos.js` refuses anything else).
- The public catalogue (`/api/catalogue/public/<slug>`) now includes `photos` for each product, beside `photo_url`.

## If the database update has not been run yet

- The shop page and the public catalogue ask for `photos`, and if the database says there is no such column they ask again without it, so the shop never looks empty and Jobtins' refresh never fails (`lib/catalogueProducts.js`).
- Saving a product with several photos saves the cover and tells the person the database needs its latest update.

## Known limits

- Photos are for **Pro** businesses (that is where the photo field already was).
- Photo changes need an internet connection. An edit made offline saves the other changes and says so; photos must be changed again when back online.
- The CSV import does not carry photos.
- The separate offline version of Reseeti is not changed.

## Files

New: `supabase/schema_stage61.sql`, `lib/productPhotos.js`, `lib/compressImage.js`, `lib/catalogueProducts.js`.
Changed: `app/dashboard/inventory/ProductForm.jsx`, `app/dashboard/inventory/page.js`, `app/dashboard/catalogue/page.js` (wording only), `app/shop/[slug]/ShopCart.jsx`, `app/shop/[slug]/page.js`, `app/api/catalogue/public/[slug]/route.js`.

## Tests

Kept with the Jobtins project, which drives the real files in a browser: the database change including older-app behaviour, the photo rules, the real product form with a fake database and storage (53 checks), the shop gallery (165 checks with the existing shop checks) and the public endpoint.
