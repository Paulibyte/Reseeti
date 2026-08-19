// Self-contained (doesn't reuse lib/idbCache.js's API, which this file's
// author hasn't directly verified) — a single object store, get/set by
// invoice id. Deliberately minimal: this exists for exactly one thing,
// letting /inv/[id] render from a local copy when the live fetch to
// /api/invoices/[id]/receipt-data fails, not as a general-purpose cache.
const DB_NAME = 'reseeti-receipts';
const STORE_NAME = 'receipts';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheReceipt(invoiceId, payload) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(payload, invoiceId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort — a failed cache write should never break viewing the
    // receipt right now, only the ability to view it again offline later.
  }
}

export async function getCachedReceipt(invoiceId) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(invoiceId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
