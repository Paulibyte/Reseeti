// Offline-first invoice drafting.
//
// The core idea: writes go to localStorage FIRST, always, instantly —
// never blocked on a network round trip. If we're online, we then also
// push to Supabase in the background. If we're offline, the draft just
// sits in the local queue until the browser's 'online' event fires, at
// which point everything queued gets synced automatically.
//
// This deliberately does NOT try to be a general-purpose offline database
// (no conflict resolution, no multi-device merge logic) — it solves the
// one real problem this app has: "I'm making a sale right now and my
// data just dropped."
//
// Stage 25 change: queued drafts (customer names, phone numbers, amounts)
// used to sit in localStorage as plain JSON. They're now encrypted at
// rest (see lib/encryptedStorage.js for the actual crypto and its threat
// model). Every existing caller of getQueue()/queueDraftInvoice()/etc.
// keeps working completely unchanged and synchronously — the encryption
// happens underneath via an in-memory cache that's kept in sync with an
// encrypted on-disk copy in the background, rather than making every
// call site in InvoiceForm.jsx/dashboard/page.js handle a Promise for
// what used to be a plain synchronous read.

import { encryptForStorage, decryptFromStorage, isEncryptedStorageSupported } from './encryptedStorage';

const QUEUE_KEY = 'reseeti_offline_queue_v2'; // encrypted
const LEGACY_QUEUE_KEY = 'reseeti_offline_queue'; // pre-Stage-25 plaintext, migrated once below

let memoryCache = null; // null until the first load attempt finishes
let persisting = Promise.resolve(); // chains writes so they can't race each other out of order

function readLegacyPlaintextQueue() {
  try {
    const raw = localStorage.getItem(LEGACY_QUEUE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function persistEncrypted(queue) {
  if (!isEncryptedStorageSupported()) {
    // Very old browser with no Web Crypto/IndexedDB — falls back to the
    // legacy plaintext key rather than silently losing drafts. Rare in
    // practice (this app already leans on IndexedDB elsewhere, e.g.
    // Stage 19's idbCache.js), so this path exists mainly so a queued
    // sale is never lost outright, not as a fully-supported mode.
    localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(queue));
    return;
  }
  const encrypted = await encryptForStorage(queue);
  localStorage.setItem(QUEUE_KEY, encrypted);
  localStorage.removeItem(LEGACY_QUEUE_KEY);
}

// Kicked off once, at module load, in every client component that
// imports this file — by the time a person actually clicks "Save
// invoice" (a real user action, always at least a few milliseconds after
// page load), this has essentially always already finished.
async function initialLoad() {
  if (typeof window === 'undefined') { memoryCache = []; return; }

  try {
    if (isEncryptedStorageSupported()) {
      const raw = localStorage.getItem(QUEUE_KEY);
      if (raw) {
        memoryCache = await decryptFromStorage(raw);
        return;
      }
    }
    // Nothing under the new encrypted key yet — check for a pre-upgrade
    // plaintext queue and migrate it rather than losing it.
    const legacy = readLegacyPlaintextQueue();
    memoryCache = legacy || [];
    if (legacy) await persistEncrypted(memoryCache);
  } catch {
    // Corrupted/undecryptable value (e.g. the device key was cleared
    // independently of the queue somehow) — starting empty is safer
    // than throwing on every subsequent call in this session.
    memoryCache = [];
  }
}

const ready = initialLoad();

function setQueue(queue) {
  memoryCache = queue;
  // Chained onto the previous write rather than fired independently, so
  // two rapid saves can't have their encrypt-and-persist calls resolve
  // out of order and have the second write clobbered by the first.
  persisting = persisting.then(() => persistEncrypted(queue)).catch(() => {});
}

// Synchronous, same as before Stage 25 — returns whatever's in the
// in-memory cache right now. Before the very first initialLoad() finishes
// (a handful of milliseconds after this module is first imported) this
// returns an empty array; every caller already treats "queue empty" as a
// normal, valid state, so there's no new failure mode here.
export function getQueue() {
  return memoryCache || [];
}

// Called the instant a business owner hits "Save invoice." Returns a
// locally-generated draft immediately — the UI never waits on this.
export function queueDraftInvoice(draft) {
  const queue = getQueue();
  const localId = 'draft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const entry = { localId, status: 'pending', createdAt: new Date().toISOString(), ...draft };
  queue.push(entry);
  setQueue(queue);
  // Fire-and-forget — doesn't block returning the draft to the caller,
  // and if the browser doesn't support Background Sync this is a no-op
  // (see requestBackgroundSync's fallback comment above).
  requestBackgroundSync();
  return entry;
}

export function removeFromQueue(localId) {
  setQueue(getQueue().filter((d) => d.localId !== localId));
}

// ---------- Generic offline edits (products, customers) ----------
//
// Separate from queueDraftInvoice above because an edit to an EXISTING
// row needs something invoice creation never had to worry about:
// another device could have changed that same row in the meantime. This
// queues the edit alongside a "base version" (the row's updated_at at
// the moment this device started editing it — see schema_stage26.sql's
// set_updated_at triggers, which make updated_at a reliable,
// database-controlled version marker rather than something client code
// has to remember to set correctly). Same encrypted, in-memory-cached
// localStorage backing as invoice drafts — queueEdit/syncEdits just add
// a second kind of entry to the same queue array.
export function queueEdit({ table, id, changes, baseUpdatedAt }) {
  const queue = getQueue();
  const localId = 'edit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const entry = { localId, kind: 'edit', status: 'pending', table, id, changes, baseUpdatedAt, createdAt: new Date().toISOString() };
  queue.push(entry);
  setQueue(queue);
  requestBackgroundSync();
  return entry;
}

// Applies every queued edit, checking each row's CURRENT updated_at
// against the base version the edit was made against:
//   - Match (or the row's version is older, which can happen if this
//     same device queued the edit before ever seeing a newer version) →
//     safe to apply, nobody else touched this row in between.
//   - Mismatch → a genuine conflict: another device changed this exact
//     row after this device started its own edit. Left in the queue
//     with status 'conflict' rather than either silently overwriting the
//     other device's change (which could quietly lose real data — a
//     stock count from one till, a phone number correction from
//     another) or silently discarding this device's edit. A person
//     decides via resolveEditConflict below.
//   - Row no longer exists → also a conflict (can't edit something
//     that's been deleted elsewhere); resolution here is really only
//     "discard my edit," but it goes through the same conflict path
//     rather than a special case.
async function syncEdits(supabase, onProgress) {
  const queue = getQueue();
  const pending = queue.filter((d) => d.kind === 'edit' && d.status === 'pending');
  let synced = 0, conflicts = 0;

  for (const edit of pending) {
    try {
      const { data: current, error: fetchError } = await supabase
        .from(edit.table)
        .select('updated_at')
        .eq('id', edit.id)
        .maybeSingle();
      if (fetchError) throw fetchError;

      const rowDeleted = !current;
      const versionMatches = current && current.updated_at === edit.baseUpdatedAt;

      if (rowDeleted || !versionMatches) {
        markConflict(edit.localId, { serverUpdatedAt: current?.updated_at || null, rowDeleted });
        conflicts++;
        onProgress?.({ edit, status: 'conflict' });
        continue;
      }

      const { error: updateError } = await supabase.from(edit.table).update(edit.changes).eq('id', edit.id);
      if (updateError) throw updateError;

      removeFromQueue(edit.localId);
      synced++;
      onProgress?.({ edit, status: 'synced' });
    } catch (err) {
      // A transient failure (offline, network hiccup) — left pending,
      // same as an invoice draft, for the next sync pass to retry.
      onProgress?.({ edit, status: 'failed', error: err.message });
    }
  }

  return { synced, conflicts };
}

function markConflict(localId, details) {
  setQueue(getQueue().map((e) => (e.localId === localId ? { ...e, status: 'conflict', conflictDetails: details } : e)));
}

export function getEditConflicts() {
  return getQueue().filter((d) => d.kind === 'edit' && d.status === 'conflict');
}

// Called from the Sync Conflicts UI once a person decides what to do
// with one conflicting edit:
//   - 'keep_mine' — apply this device's changes anyway, on top of
//     whatever the other device wrote. Re-reads the row's current
//     updated_at first so this doesn't just immediately conflict again
//     next sync.
//   - 'discard_mine' — drop this device's queued edit entirely, keeping
//     whatever the other device (or a deletion) left in place.
export async function resolveEditConflict(supabase, localId, resolution) {
  const queue = getQueue();
  const edit = queue.find((e) => e.localId === localId);
  if (!edit) return { ok: false };

  if (resolution === 'discard_mine') {
    removeFromQueue(localId);
    return { ok: true };
  }

  if (resolution === 'keep_mine') {
    const { data: current } = await supabase.from(edit.table).select('updated_at').eq('id', edit.id).maybeSingle();
    if (!current) {
      // The row is gone — there's nothing left to apply "mine" on top
      // of, so this can only resolve as discarding the edit.
      removeFromQueue(localId);
      return { ok: true, note: 'That record no longer exists — the edit was discarded.' };
    }
    const { error } = await supabase.from(edit.table).update(edit.changes).eq('id', edit.id);
    if (error) return { ok: false, error: error.message };
    removeFromQueue(localId);
    return { ok: true };
  }

  return { ok: false, error: 'Unknown resolution' };
}

// Pushes every pending draft to Supabase. Safe to call repeatedly — e.g.
// on page load, on the 'online' event, and after every save attempt.
// Drafts that fail (still offline, or a real error) simply stay queued
// for the next attempt rather than being lost.
export async function syncQueue(supabase, businessId, onProgress) {
  await ready; // make sure any pre-upgrade plaintext queue has been loaded/migrated first
  const queue = getQueue();
  // Excludes kind: 'edit' entries — those go through syncEdits below,
  // since they need the version-conflict check invoice drafts never
  // did. Without this filter, an edit entry (which has no .items,
  // .customer_phone, etc.) would be processed by the invoice-insert
  // logic below and fail in confusing ways.
  const pending = queue.filter((d) => d.kind !== 'edit' && d.status === 'pending');

  // Resolved once per sync batch rather than per draft — who's signed
  // in doesn't change mid-loop, and this is what lets Stage 30's
  // stock_movements log ("who sold it") record a real seller rather
  // than leaving every automatic sale-deduction attributed to nobody.
  //
  // Wrapped in try/catch deliberately: getUser() makes a real network
  // call, and navigator.onLine (what gates whether syncQueue even gets
  // called) only reflects whether a network interface is active, not
  // whether it actually has a working connection — "online" can still
  // mean this request fails. A failure here must never abort the whole
  // sync: every draft in `pending` is already safely saved locally, and
  // losing just the "who sold it" attribution for this attempt (falling
  // back to null, exactly like before this existed) is a far smaller
  // problem than crashing the invoice form giving the false impression
  // the sale itself was lost.
  let syncingUser = null;
  try {
    const { data } = await supabase.auth.getUser();
    syncingUser = data?.user || null;
  } catch {
    // Stays null — this sync attempt's stock movements (if any go
    // through below) just won't have a seller attached. The next
    // successful sync (once connectivity is actually real) will still
    // correctly attribute anything synced at that point.
  }

  let synced = 0;
  let failed = 0;

  for (const draft of pending) {
    try {
      // If the invoice form's customer dropdown already resolved a real
      // profile (existing pick, or a new one saved inline), trust that —
      // no need to re-derive it. Only walk-in drafts (no customer_id, just
      // free-typed name/phone) fall through to the phone-matching logic
      // below, which uses phone as the natural dedupe key (see the unique
      // constraint on customers(business_id, phone)). Without a phone, we
      // deliberately don't auto-create a profile, since a name alone isn't
      // a reliable way to avoid creating duplicate customers; the invoice
      // still keeps its own customer_name text either way.
      let customerId = draft.customer_id || null;
      if (!customerId && draft.customer_phone) {
        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('business_id', businessId)
          .eq('phone', draft.customer_phone)
          .maybeSingle();

        if (existing) {
          customerId = existing.id;
        } else {
          const { data: created } = await supabase
            .from('customers')
            .insert({ business_id: businessId, name: draft.customer_name, phone: draft.customer_phone })
            .select()
            .single();
          customerId = created?.id ?? null;
        }
      }

      const { data: invoice, error } = await supabase
        .from('invoices')
        .insert({
          business_id: businessId,
          customer_id: customerId,
          customer_name: draft.customer_name,
          customer_phone: draft.customer_phone,
          subtotal: draft.subtotal,
          discount: draft.discount,
          loyalty_discount_applied: draft.loyalty_discount_applied || false,
          loyalty_discount_amount: draft.loyalty_discount_amount || 0,
          service_charge_rate: draft.service_charge_rate || 0,
          service_charge_amount: draft.service_charge_amount || 0,
          vat_rate: draft.vat_rate || 0,
          vat_amount: draft.vat_amount || 0,
          shipping_fee: draft.shipping_fee || 0,
          withholding_tax_rate: draft.withholding_tax_rate || 0,
          withholding_tax_amount: draft.withholding_tax_amount || 0,
          total: draft.total,
          estimated_delivery_date: draft.estimated_delivery_date || null,
          due_date: draft.due_date || null,
          custom_field_values: draft.custom_field_values || [],
          created_by: syncingUser?.id || null,
          // Stage 32 idempotency key — see schema_stage32.sql. Lets a
          // retried sync of this exact draft (invoice_items failed last
          // time, so this draft never got marked synced) be recognized
          // as "already done" instead of creating a second invoice.
          client_ref: draft.localId,
        })
        .select()
        .single();

      if (error) {
        // Postgres unique-violation on our own client_ref index means
        // this exact draft already has an invoice from a prior sync
        // attempt — not a real failure. Look it up and treat it as
        // success rather than surfacing an error the person would have
        // no way to act on (retrying would just hit the same thing).
        if (error.code === '23505' && /client_ref/.test(error.message || '')) {
          const { data: existing } = await supabase
            .from('invoices')
            .select('id')
            .eq('business_id', businessId)
            .eq('client_ref', draft.localId)
            .single();
          if (existing) {
            removeFromQueue(draft.localId);
            synced++;
            onProgress?.({ draft, status: 'synced' });
            continue;
          }
        }
        throw error;
      }

      // product_id is included whenever a line item was picked from
      // inventory rather than typed freehand — that's what lets the
      // database trigger deduct stock automatically on insert.
      const itemRows = draft.items.map((it, i) => ({
        invoice_id: invoice.id,
        product_id: it.product_id || null,
        description: it.description,
        qty: it.qty,
        price: it.price,
        sort_order: i,
      }));
      const { error: itemsError } = await supabase.from('invoice_items').insert(itemRows);
      if (itemsError) throw itemsError;

      removeFromQueue(draft.localId);
      synced++;
      onProgress?.({ draft, status: 'synced' });
    } catch (err) {
      // The Stage 26 database trigger that enforces the free-plan
      // monthly invoice limit (see schema_stage26.sql) raises a specific,
      // recognizable message when it blocks an insert. That's different
      // from a transient failure (still offline, a network hiccup): a
      // plan-limit rejection will keep failing on every retry until the
      // business upgrades, so it's surfaced as its own status rather than
      // silently retried forever alongside genuinely-temporary failures.
      const isPlanLimitBlocked = /free plan limit/i.test(err.message || '');
      failed++;
      onProgress?.({
        draft,
        status: isPlanLimitBlocked ? 'blocked_plan_limit' : 'failed',
        error: err.message,
      });
      // Left in the queue either way — a plan-limit block is resolved by
      // upgrading (see dashboard/page.js's notice for this status), not
      // by discarding a real sale that still needs to be recorded once
      // that happens.
    }
  }

  // Runs every time syncQueue does — a business making offline invoice
  // sales and offline product/customer edits in the same session (very
  // plausible: a trader offline for a stretch might both ring up a sale
  // and correct a price) gets both kinds resolved by the one call
  // dashboard/page.js's attemptSync() already makes.
  const editResults = await syncEdits(supabase, onProgress);

  return { synced: synced + editResults.synced, failed, conflicts: editResults.conflicts };
}

export function pendingCount() {
  return getQueue().filter((d) => d.status === 'pending').length;
}

// Background Sync API: asks the browser to fire a 'sync' event on the
// service worker once connectivity is back, even if this tab has been
// backgrounded or the browser deferred the retry (mobile Chrome does this
// deliberately, batching sync attempts to save battery). This is a real
// improvement over the plain 'online' event the dashboard also listens
// for: 'online' only fires while the tab is open and foregrounded on
// most mobile browsers, which is exactly the situation a trader closing
// the app to answer a call would hit.
//
// The service worker itself can't safely finish the sync alone — it
// would need the signed-in user's Supabase session, which lives in this
// tab's storage, not the worker's. So sw.js's 'sync' handler just
// messages every open client to say "try now"; see
// onBackgroundSyncMessage below for the client-side half of that handoff.
// If neither Background Sync nor an open tab is available, the queue
// still catches up the next time the app is opened at all (load() calls
// attemptSync() unconditionally on mount).
export async function requestBackgroundSync() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('sync' in reg)) return false;
    await reg.sync.register('reseeti-sync-invoices');
    return true;
  } catch {
    // SyncManager throws if permission was denied or the browser doesn't
    // really support it despite the feature-detect (older Firefox does
    // this) — the queue just falls back to syncing on next app open.
    return false;
  }
}

// Subscribes to the service worker's "please sync now" message. Returns
// an unsubscribe function for use in a useEffect cleanup.
export function onBackgroundSyncMessage(callback) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const handler = (event) => {
    if (event.data?.type === 'RESEETI_SYNC_REQUESTED') callback();
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
