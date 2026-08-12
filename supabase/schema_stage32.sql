-- Stage 32 migration: run in the Supabase SQL editor after schema_stage31
-- (or whatever your latest applied stage is).
--
-- Fixes a real duplicate-invoice bug: lib/offlineQueue.js's syncQueue()
-- inserts an invoice, then separately inserts its invoice_items. If
-- anything between those two steps fails (a network hiccup mid-sync —
-- exactly the kind of flaky connectivity this whole offline system
-- exists to handle), the draft never got marked as synced, so the next
-- sync attempt re-submitted the exact same draft from scratch — creating
-- a second, genuinely separate invoice row for the same sale. Deleting
-- one of the two didn't "fail to delete" either; the other one was
-- always a distinct row that was never touched.
--
-- client_ref carries over queueDraftInvoice's localId (already a unique
-- per-draft id, generated the moment a sale is queued — see
-- lib/offlineQueue.js) so a retried insert for the same draft can be
-- recognized and rejected by the database itself, rather than relying
-- on the client to always get its own retry logic right.
alter table invoices add column if not exists client_ref text;

-- Scoped per business rather than globally unique: client_ref values are
-- generated from Date.now() + a random suffix, so cross-business
-- collisions are already effectively impossible, but scoping the
-- constraint keeps the failure mode local to one business's own retries
-- rather than (even theoretically) one business's insert ever being
-- blocked by an unrelated business's client_ref. NULLs (invoices created
-- through any path that doesn't set client_ref — the mark-paid flow,
-- admin actions, anything server-side) are unconstrained, since a
-- unique index ignores NULLs by default.
create unique index if not exists idx_invoices_client_ref
  on invoices(business_id, client_ref);
