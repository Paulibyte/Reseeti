-- Stage 57 migration: run in the Supabase SQL editor after schema_stage56.
--
-- Phase 4, fourth and final vertical — Laboratory billing. Same
-- speculative-build caveat as the previous three, and the same
-- deliberate scope boundary as Clinic Billing (schema_stage56.sql):
-- this records ONLY which tests were ordered and billed — never
-- results. A test result is genuinely clinical/health data; Reseeti
-- bills for lab work, it doesn't report on it.
--
-- referring_doctor is the one field this has that Clinic didn't —
-- included because it's business/relationship information (who
-- referred this patient, relevant for billing arrangements or referral
-- tracking), not the patient's own health data, so it doesn't cross the
-- same line a results or diagnosis field would.
create table if not exists lab_test_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  customer_id uuid references customers(id) on delete cascade not null,
  order_date date not null default current_date,
  referring_doctor text,
  items jsonb not null default '[]'::jsonb,
  invoice_id uuid references invoices(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_lab_test_orders_business on lab_test_orders(business_id, order_date desc);

alter table lab_test_orders enable row level security;

create policy "Members manage lab test orders" on lab_test_orders for all
  using (business_id in (select my_active_business_ids()))
  with check (business_id in (select my_active_business_ids()));
