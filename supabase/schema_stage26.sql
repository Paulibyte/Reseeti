-- Stage 26 migration: run in the Supabase SQL editor after schema_stage25
-- (or whatever your latest applied stage is).
--
-- Two unrelated halves, covered in one migration since they shipped
-- together: (1) making the free-plan invoice limit an actual database
-- rule instead of a client-side UI gate, plus subscription grace-period
-- handling; (2) the schema multi-device sync needs — reliable
-- server-controlled updated_at columns for conflict detection, and
-- Realtime replication turned on for the tables that now sync live
-- across devices. See README_STAGE26.md for the full picture.

-- ==================================================================
-- PART 1 — Subscription enforcement
-- ==================================================================

-- This table was already referenced by app/dashboard/page.js before this
-- stage ("see schema_stage15.sql" in that file's own comment) but never
-- actually created in any migration — a real bug this stage fixes rather
-- than just working around. Every read of it was silently returning
-- null and falling back to a hardcoded default of 5, which happened to
-- match this seed value, so the bug was invisible in practice. It won't
-- stay invisible the first time you actually want to change the
-- platform-wide free limit from the SQL editor rather than a code
-- deploy.
create table if not exists platform_settings (
  id int primary key default 1,
  free_plan_invoice_limit int not null default 5,
  constraint single_row check (id = 1)
);

insert into platform_settings (id, free_plan_invoice_limit)
values (1, 5)
on conflict (id) do nothing;

alter table platform_settings enable row level security;

-- Read-only from the client on purpose — there's exactly one row, and
-- changing it is an operator action (Supabase SQL editor), not
-- something any business's users should be able to trigger.
create policy "Anyone signed in can read platform settings"
  on platform_settings for select
  using (auth.role() = 'authenticated');

-- A business-specific override (set manually by you, the operator, for
-- a specific business — e.g. a grandfathered higher limit) — was also
-- already referenced in app/dashboard/page.js before this stage, same
-- situation as platform_settings above.
alter table businesses add column if not exists monthly_invoice_limit int;

-- Tracks an in-progress grace period after a Pro subscription lapses —
-- null means "not in grace" (either current, or already downgraded).
alter table businesses add column if not exists plan_grace_until timestamptz;

-- THE core fix for "users should never be able to bypass Pro": this used
-- to be enforced only by the dashboard UI hiding the "+ Create Invoice"
-- button once at the limit — which does nothing to stop a direct
-- supabase-js call (e.g. from the browser console) that skips the UI
-- entirely. A database trigger fires on every insert into `invoices`
-- regardless of which code path or role performs it — the normal
-- invoice form, the offline sync queue, or a raw API call — so there is
-- no route around it.
create or replace function enforce_invoice_plan_limit()
returns trigger as $$
declare
  v_plan text;
  v_limit int;
  v_count int;
  v_month_start timestamptz;
begin
  select plan, coalesce(
    monthly_invoice_limit,
    (select free_plan_invoice_limit from platform_settings where id = 1),
    5
  )
  into v_plan, v_limit
  from businesses
  where id = new.business_id;

  -- Pro (and any future non-free plan) has no monthly cap.
  if v_plan <> 'free' then
    return new;
  end if;

  v_month_start := date_trunc('month', now());

  select count(*) into v_count
  from invoices
  where business_id = new.business_id
    and created_at >= v_month_start;

  if v_count >= v_limit then
    raise exception 'Free plan limit of % invoices this month has been reached. Upgrade to Pro to keep creating invoices.', v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_enforce_invoice_plan_limit on invoices;
create trigger trg_enforce_invoice_plan_limit
  before insert on invoices
  for each row execute function enforce_invoice_plan_limit();

-- ==================================================================
-- PART 2 — Multi-device sync support
-- ==================================================================

-- expenses had no updated_at at all before this stage (products and
-- customers already did, from Stage 6) — needed for the same reason:
-- conflict detection on an offline edit compares "what updated_at did
-- this device see when it made its edit" against "what updated_at does
-- the row actually have now," and that only works if updated_at is
-- reliably maintained.
alter table expenses add column if not exists updated_at timestamptz default now();

-- A single generic trigger function, reused across all three tables
-- below, rather than three copies of the same three lines — and
-- crucially, DATABASE-enforced rather than relying on every client call
-- site remembering to set updated_at itself (which is what happened
-- before this stage: ProductForm.jsx and the customer edit page each set
-- it manually in their own update payloads — easy to get right today and
-- easy to forget in whatever's added next). A trigger means conflict
-- detection can trust updated_at as a real, tamper-proof version marker
-- no matter what code performs the update.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at
  before update on customers
  for each row execute function set_updated_at();

drop trigger if exists trg_expenses_updated_at on expenses;
create trigger trg_expenses_updated_at
  before update on expenses
  for each row execute function set_updated_at();

-- Turns on Realtime (Postgres change streaming over websocket) for the
-- three tables that now sync live across a business's open devices —
-- see lib/useRealtimeSync.js. Wrapped in a DO block with an existence
-- check because re-adding a table already in the publication throws an
-- error rather than silently no-op'ing, which would otherwise make this
-- migration non-repeatable.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'invoices'
  ) then
    alter publication supabase_realtime add table invoices;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table products;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'customers'
  ) then
    alter publication supabase_realtime add table customers;
  end if;
end $$;
