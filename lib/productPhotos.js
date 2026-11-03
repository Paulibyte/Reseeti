// Shared rules for a product's photos, used by the inventory form, the shop page and the public catalogue.
//
// A product has an ordered list of photos, `photos`, and the first one is the cover. The older single field,
// `photo_url`, is kept equal to the cover (the database makes sure of it, see schema_stage61.sql), so anything that
// still reads one photo keeps working.

export const MAX_PRODUCT_PHOTOS = 8;

const BUCKET_MARK = '/storage/v1/object/public/logos/';

// A web address of a picture, or null. Only http(s), and not absurdly long.
export function cleanPhotoUrl(u) {
  if (typeof u !== 'string') return null;
  const t = u.trim();
  if (!t || t.length > 600) return null;
  return /^https?:\/\//i.test(t) ? t : null;
}

// The photos of a product, cover first, with no repeats and no more than the limit.
// Products saved before several photos existed only have photo_url, which is treated as a one-photo list.
export function photosOf(product) {
  if (!product) return [];
  const out = [];
  const seen = new Set();
  const list = Array.isArray(product.photos) ? product.photos : [];
  for (const u of list) {
    const c = cleanPhotoUrl(u);
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  if (out.length === 0) {
    const c = cleanPhotoUrl(product.photo_url);
    if (c) out.push(c);
  }
  return out.slice(0, MAX_PRODUCT_PHOTOS);
}

// Move the photo at `from` to position `to` (a new list; the original is untouched).
export function movePhoto(list, from, to) {
  if (!Array.isArray(list) || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// Make the photo at `index` the cover (first).
export function makeCover(list, index) {
  return movePhoto(list, index, 0);
}

// The file extension of an upload, safe to put in a storage path.
export function safeExt(fileName) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(fileName || ''));
  return m ? m[1].toLowerCase() : 'jpg';
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// Where a new photo is stored in the "logos" bucket. Each photo gets its own name, so adding one never overwrites
// another and a browser never shows an old picture from its cache. It sits under {business}/products/, which is all
// the storage rules require (schema_stage44.sql).
export function newPhotoPath(businessId, productId, fileName) {
  return `${businessId}/products/${productId}/${randomId()}.${safeExt(fileName)}`;
}

// The storage path of a photo, but only if it is one of THIS business's product photos in our own bucket.
// Used to clean up a photo that was removed. Anything else (another business's file, a web address from elsewhere,
// a path that tries to climb out of the folder) gives null, so nothing it should not is ever deleted.
export function storagePathFor(url, businessId) {
  const c = cleanPhotoUrl(url);
  if (!c || !businessId) return null;
  const at = c.indexOf(BUCKET_MARK);
  if (at < 0) return null;
  let path = c.slice(at + BUCKET_MARK.length).split('#')[0].split('?')[0];
  try { path = decodeURIComponent(path); } catch { return null; }
  if (path.split('/').some((part) => part === '..' || part === '.' || part === '')) return null;
  return path.startsWith(`${businessId}/products/`) ? path : null;
}

// Has the list of photos changed from what was saved? (order matters: the first is the cover)
export function photosChanged(before, after) {
  if (before.length !== after.length) return true;
  return before.some((u, i) => u !== after[i]);
}
