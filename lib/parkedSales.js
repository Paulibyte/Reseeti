'use client';

// Parking a sale ("hold sale until the customer is ready to pay") is a
// different thing from lib/offlineQueue.js's queue: that holds SUBMITTED
// sales waiting to sync to Supabase. A parked sale hasn't been submitted
// at all — it's a cart still being built, set aside so the cashier can
// serve someone else, with no invoice created yet. Kept as its own
// module/storage key rather than folded into the offline queue so the
// two lists (parked vs. pending-sync) can never be confused with each
// other in the UI.
//
// Same encrypted-at-rest treatment as the offline queue (Stage 25) —
// a parked cart carries the same kind of sensitive data (customer name/
// phone, prices) sitting on a shared shop device, so it gets the same
// protection for the same reason. See lib/encryptedStorage.js.

import { encryptForStorage, decryptFromStorage, isEncryptedStorageSupported } from './encryptedStorage';

const PARKED_KEY = 'reseeti_parked_sales_v1';

let memoryCache = null;
let persisting = Promise.resolve();

async function initialLoad() {
  if (memoryCache !== null) return;
  try {
    const raw = localStorage.getItem(PARKED_KEY);
    if (!raw) { memoryCache = []; return; }
    if (isEncryptedStorageSupported()) {
      memoryCache = await decryptFromStorage(raw);
    } else {
      memoryCache = JSON.parse(raw);
    }
  } catch {
    memoryCache = [];
  }
}

const ready = typeof window !== 'undefined' ? initialLoad() : Promise.resolve();

function persist() {
  const snapshot = [...memoryCache];
  persisting = persisting.then(async () => {
    try {
      if (isEncryptedStorageSupported()) {
        const encrypted = await encryptForStorage(snapshot);
        localStorage.setItem(PARKED_KEY, encrypted);
      } else {
        localStorage.setItem(PARKED_KEY, JSON.stringify(snapshot));
      }
    } catch {
      // Best-effort, same as the offline queue — a failed write here
      // just means the park didn't stick; the cashier still has the
      // form open in front of them and can try again or just finish
      // the sale normally instead.
    }
  });
  return persisting;
}

// Returns the id assigned to this parked sale, so the caller (the
// "Parked sales" list) can key off it for resume/discard.
export async function parkSale(draft, label) {
  await ready;
  const id = `parked_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  memoryCache.push({
    id,
    label: label || draft.customer_name || 'Walk-in',
    parkedAt: new Date().toISOString(),
    draft,
  });
  await persist();
  return id;
}

export async function listParkedSales() {
  await ready;
  return [...memoryCache].sort((a, b) => new Date(b.parkedAt) - new Date(a.parkedAt));
}

// Removes and returns the parked entry so the caller can load its draft
// back into InvoiceForm — resuming always removes it from the parked
// list; if the cashier parks it again mid-edit, that's a new park call.
export async function resumeParkedSale(id) {
  await ready;
  const entry = memoryCache.find((p) => p.id === id);
  if (!entry) return null;
  memoryCache = memoryCache.filter((p) => p.id !== id);
  await persist();
  return entry;
}

export async function discardParkedSale(id) {
  await ready;
  memoryCache = memoryCache.filter((p) => p.id !== id);
  await persist();
}

export async function parkedSalesCount() {
  await ready;
  return memoryCache.length;
}
