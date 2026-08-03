-- Stage 9 migration: run in the Supabase SQL editor after schema_stage8_fix.sql
--
-- Customer database upgrade: customers already existed as of Stage 6
-- (name, phone, email, notes), but were missing address and tax ID, and
-- the invoice form only offered free-text + autocomplete rather than a
-- real "pick from your customer list" flow. This migration is the schema
-- half of that; the other half is app-side (InvoiceForm.jsx dropdown,
-- customers pages gaining the new fields).

alter table customers add column if not exists address text;
alter table customers add column if not exists tax_id text;

-- No RLS changes needed — "Members manage customers" from Stage 8 already
-- covers all columns on this table, new ones included.
