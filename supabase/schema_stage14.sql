-- Stage 14 migration: run in the Supabase SQL editor after schema_stage13.sql
--
-- Receipt improvements + Nigerian bank transfer feature.

-- ---------- 1. Business-level receipt details ----------
-- All optional — the receipt only shows a section if the business has
-- actually filled it in (a business with no bank details just doesn't get
-- a "Pay via bank transfer" panel, rather than showing empty fields).

alter table businesses add column if not exists bank_name text;
alter table businesses add column if not exists bank_account_name text;
alter table businesses add column if not exists bank_account_number text;
alter table businesses add column if not exists terms_and_conditions text;
-- Reuses the existing 'logos' storage bucket/policies from schema_stage4.sql
-- (path convention: logos/{business_id}/signature.png) rather than standing
-- up a whole new bucket for one more image per business.
alter table businesses add column if not exists signature_url text;

-- ---------- 2. Payment method on invoices ----------
-- Recorded at the moment an invoice is marked paid (see the "Mark paid"
-- flow in app/dashboard/page.js), so the receipt can show *how* it was
-- paid — cash, bank transfer, card, or one of the subscription gateways —
-- not just paid/unpaid. Free text rather than an enum: a business may
-- want to type something the app's own payment options don't cover.

alter table invoices add column if not exists payment_method text;

-- ---------- 3. Estimated delivery date ----------
-- For goods/services not handed over on the spot.

alter table invoices add column if not exists estimated_delivery_date date;

-- ---------- 4. Customer signature ----------
-- Captured once by the customer on the public receipt page (a drawn
-- signature — a lightweight proof-of-receipt, not a legally-binding
-- e-signature). Written only by app/api/invoices/[id]/signature, which
-- refuses to overwrite one that's already set.

alter table invoices add column if not exists customer_signature_data text;

-- ---------- 5. Receipt verification code ----------
-- A short, unique, human-readable code printed on every receipt. Visiting
-- /verify/{code} shows the real invoice details pulled fresh from the
-- database — so if someone alters a screenshot or printed copy of a
-- receipt, the numbers won't match what /verify shows for that code.
-- Generated automatically for every invoice (existing rows get one via the
-- backfill below; every new row gets one via the column default).

alter table invoices add column if not exists verification_code text;

update invoices
  set verification_code = upper(substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 8))
  where verification_code is null;

alter table invoices alter column verification_code
  set default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
alter table invoices alter column verification_code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_verification_code_unique'
  ) then
    alter table invoices add constraint invoices_verification_code_unique unique (verification_code);
  end if;
end $$;

-- Note on collisions: an 8-character code drawn from md5 hex output has
-- roughly 4.3 billion possible values, so a collision on insert is
-- vanishingly unlikely at the scale this app operates at — but if it ever
-- happens, the insert fails and simply needs a retry (Postgres re-evaluates
-- the default expression per attempt).
