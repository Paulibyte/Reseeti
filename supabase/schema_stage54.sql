-- Stage 54 migration: run in the Supabase SQL editor after schema_stage53.
--
-- Phase 4, first vertical — Construction billing. Built speculatively
-- (no specific real business validating this workflow yet, confirmed
-- explicitly before starting), which is exactly why this is scoped
-- leaner than School Billing: projects + milestones + progress
-- invoicing with retention, not every construction-industry concept
-- (change orders, BOQ line-item tracking, subcontractor billing) —
-- those can be added later against real demand rather than guessed at
-- now.
--
-- Retention is the one genuinely construction-specific concept worth
-- building from day one: withholding a percentage of each milestone
-- payment (commonly 5-10%) until the project is fully complete is
-- near-universal practice in construction contracts, not an edge case.
create table if not exists construction_projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  customer_id uuid references customers(id) on delete set null,
  name text not null,
  description text,
  contract_value numeric(14,2) not null default 0,
  retention_percent numeric(5,2) not null default 0 check (retention_percent >= 0 and retention_percent <= 100),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists construction_milestones (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  project_id uuid references construction_projects(id) on delete cascade not null,
  name text not null,
  amount numeric(14,2) not null check (amount >= 0),
  sort_order int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'invoiced')),
  invoice_id uuid references invoices(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_construction_milestones_project on construction_milestones(project_id);

-- retention_amount is its own field, deliberately not folded into the
-- existing `discount` column — a discount means the client never owes
-- that money at all; retention means they still owe it, just later,
-- once the project completes. Conflating the two would make an
-- invoice's total look like a discount was given when actually a
-- portion was simply deferred.
alter table invoices add column if not exists construction_project_id uuid references construction_projects(id) on delete set null;
alter table invoices add column if not exists retention_amount numeric(14,2) not null default 0;

alter table construction_projects enable row level security;
alter table construction_milestones enable row level security;

create policy "Members manage construction projects" on construction_projects for all
  using (business_id in (select my_active_business_ids()))
  with check (business_id in (select my_active_business_ids()));

create policy "Members manage construction milestones" on construction_milestones for all
  using (business_id in (select my_active_business_ids()))
  with check (business_id in (select my_active_business_ids()));
