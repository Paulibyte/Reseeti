-- Stage 56 migration: run in the Supabase SQL editor after schema_stage55.
--
-- Phase 4, third vertical — Clinic billing. Same speculative-build
-- caveat as Construction and Hotel — no specific real clinic
-- validating this workflow.
--
-- Deliberately the leanest of the three, for two reasons: (1) genuine
-- reuse — the Products/Services split (Phase 2) already covers a
-- clinic's billable services (Consultation Fee, Dressing, Injection,
-- etc. as type='service' products), so nothing new was needed there;
-- a "patient" is just a customer, reused directly rather than a
-- separate near-duplicate table. (2) a deliberate scope boundary, not
-- an oversight: this table holds ONLY what was billed for a visit —
-- no diagnosis, symptoms, treatment notes, or any other clinical/
-- medical data field exists here at all. Reseeti is a billing tool,
-- not a clinical records system, and health information is
-- genuinely sensitive data this app has no business storing.
create table if not exists clinic_visits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  customer_id uuid references customers(id) on delete cascade not null,
  visit_date date not null default current_date,
  -- Self-contained snapshot (description/qty/price), same pattern used
  -- throughout this project (catalogue orders, recurring invoices) —
  -- what was billed at the time, independent of whether the underlying
  -- service/product listing changes later.
  items jsonb not null default '[]'::jsonb,
  invoice_id uuid references invoices(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_clinic_visits_business on clinic_visits(business_id, visit_date desc);

alter table clinic_visits enable row level security;

create policy "Members manage clinic visits" on clinic_visits for all
  using (business_id in (select my_active_business_ids()))
  with check (business_id in (select my_active_business_ids()));
