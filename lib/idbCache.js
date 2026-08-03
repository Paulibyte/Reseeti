// Read-side cache, separate from offlineQueue.js (which is the write-side
// queue for new invoices made while offline). This file exists so that
// dashboard/customers/inventory pages can *paint instantly* from the last
// good snapshot instead of showing a blank "Loading…" screen while
// Supabase responds — and so those same lists remain readable (if stale)
// when the connection drops entirely.
//
// Deliberately IndexedDB rather than localStorage: localStorage is
// synchronous (blocks the main thread on every read/write) and capped
// around 5MB, which a business with a few thousand invoices/customers can
// realistically approach once you include line items. IndexedDB is async
// and effectively uncapped for this app's purposes.
//
// This is a cache, not a source of truth — every read here is paired with
// a live network fetch that overwrites it (stale-while-revalidate). If a
// write here fails (private browsing, storage quota, an old Safari) the
// caller still has the network data it already fetched; caching is just
// skipped silently.

const DB_NAME = 'reseeti-cache';
const DB_VERSION = 1;
const STORES = ['invoices', 'customers', 'products', 'meta'];

let dbPromise = null;

function openDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    // If IndexedDB is unavailable or blocked (e.g. private browsing in
    // some browsers), fall back to "no cache" rather than throwing —
    // every call site below already treats a null/empty result as
    // "nothing cached yet."
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

// Replaces the entire contents of `store` for one business with `rows`.
// Scoped by businessId (via a compound key prefix) so switching accounts
// on a shared device can't leak one business's cached data into another's
// read path.
export async function cacheSetAll(store, businessId, rows) {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    // Clear only this business's previously-cached rows, not the whole
    // store (a shared device may hold a second business's cache too, from
    // a team member who signed in with a different account earlier).
    const range = IDBKeyRange.bound(`${businessId}:`, `${businessId}:\uffff`);
    const cursorReq = os.openCursor(range);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) { cursor.delete(); cursor.continue(); return; }
      (rows || []).forEach((row) => os.put({ ...row, id: `${businessId}:${row.id}` }));
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// Returns the cached rows for one business, oldest write order preserved
// (callers re-sort/re-slice as needed — this is just "what did we last
// see", not a query engine).
export async function cacheGetAll(store, businessId) {
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const range = IDBKeyRange.bound(`${businessId}:`, `${businessId}:\uffff`);
    const req = os.getAll(range);
    req.onsuccess = () => {
      const rows = (req.result || []).map((r) => {
        const { id, ...rest } = r;
        return { ...rest, id: id.slice(String(businessId).length + 1) };
      });
      resolve(rows);
    };
    req.onerror = () => resolve([]);
  });
}

// Small key/value bucket for single values that aren't row lists — e.g.
// last-synced timestamps, cached stat totals.
export async function cacheGetMeta(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function cacheSetMeta(key, value) {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ id: key, value });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
