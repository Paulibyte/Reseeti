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

// Proactively fills this cache for a batch of invoice ids — called from
// the dashboard right after it successfully loads its own invoice list
// online (see app/dashboard/page.js), so a later cold, offline app open
// can actually open a previously-saved invoice, not just see its name
// in the dashboard's list. Without this, an invoice only ever became
// available offline if someone had individually reopened its receipt
// page at least once — meaning a salesperson who creates invoices all
// day but never revisits each one afterward would find every single
// one unreachable the moment they went offline, even right after
// creating them.
//
// Fire-and-forget from the caller's point of view: never blocks the
// dashboard's own render, and a failure on any one invoice (or the
// whole batch, if the connection drops mid-warm) just means those
// invoices aren't available offline yet — not an error surfaced
// anywhere. Batched a few at a time rather than all at once, since
// firing 50 simultaneous requests against a small VPS on every single
// dashboard load would be needlessly heavy for what's ultimately a
// background nice-to-have, not something anyone is waiting on.
const WARM_BATCH_SIZE = 5;

export async function warmReceiptCache(invoiceIds) {
  for (let i = 0; i < invoiceIds.length; i += WARM_BATCH_SIZE) {
    const batch = invoiceIds.slice(i, i + WARM_BATCH_SIZE);
    await Promise.all(batch.map(async (id) => {
      try {
        const res = await fetch(`/api/invoices/${id}/receipt-data`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          await cacheReceipt(id, data);
        }
      } catch {
        // Best-effort — see this function's own comment above.
      }
    }));
  }
}
