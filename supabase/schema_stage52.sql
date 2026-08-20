-- Stage 52 migration: run in the Supabase SQL editor after schema_stage51.
--
-- Phase 2, step 3 of 6 — Custom invoice fields. Confirmed design: a
-- business defines field names once (e.g. "PO Number"), reused on every
-- invoice afterward, with three supported types (text/number/date).
--
-- custom_field_values is stored as a self-contained JSON snapshot
-- (label + type + value, not just a value keyed by definition id) —
-- deliberately, so an invoice keeps showing exactly what a field was
-- called and what type it was at the time it was created, even if the
-- business later renames or deletes that field definition. Same
-- reasoning already used for catalogue_orders.items (Stage 45): a
-- historical record shouldn't silently change because something it
-- referenced changed later.
create table if not exists custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  label text not null,
  field_type text not null default 'text' check (field_type in ('text', 'number', 'date')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_custom_field_definitions_business on custom_field_definitions(business_id);

alter table custom_field_definitions enable row level security;

create policy "Members manage custom field definitions" on custom_field_definitions for all
  using (business_id in (select my_active_business_ids()))
  with check (business_id in (select my_active_business_ids()));

-- Nullable, defaults to an empty array — every existing invoice (and
-- every new one where nobody's defined any custom fields) is completely
-- unaffected.
alter table invoices add column if not exists custom_field_values jsonb not null default '[]'::jsonb;
