-- Stage 34 migration: run in the Supabase SQL editor after schema_stage33.
--
-- Moves the 3 subscription tiers out of lib/planTiers.js (hardcoded)
-- and into a real table an admin can edit from /admin — add a tier,
-- change a price, retire one, without a code deploy.

-- Stage 33's plan_interval check constraint assumed exactly 3 fixed ids
-- (monthly/biannual/annual). Now that an admin can create any tier id,
-- that fixed list no longer makes sense — validity is enforced by the
-- app layer checking against plan_tiers itself (does this id exist and
-- is it active?), not a database enum.
alter table businesses drop constraint if exists businesses_plan_interval_check;

create table if not exists plan_tiers (
  id text primary key, -- a short slug, e.g. 'monthly' — chosen by the admin when creating it, immutable after (see the admin UI's note on this)
  label text not null,
  amount_naira numeric(12,2) not null check (amount_naira > 0),
  months int not null check (months > 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table plan_tiers enable row level security;

-- Readable directly by any signed-in user — pricing isn't sensitive,
-- and the UpgradeModal (an ordinary client component, not a server
-- route) needs to read active tiers straight from the browser client,
-- same reasoning as platform_settings.free_plan_invoice_limit (Stage
-- 26). Only active tiers, though — retired ones stay visible to the
-- admin dashboard (via the service-role client, which bypasses RLS
-- entirely) but not to the ordinary upgrade flow.
create policy "Signed-in users view active plan tiers"
  on plan_tiers for select
  using (auth.uid() is not null and active = true);

-- No insert/update/delete policy at all — same "operator action, not a
-- client-triggerable one" stance as platform_settings and
-- platform_admins. All writes go through /api/admin/plan-tiers/*,
-- which uses the service-role client after checking platform_admins.

-- Seed with the 3 tiers that existed as hardcoded values before this
-- migration, so nothing breaks the moment this runs.
insert into plan_tiers (id, label, amount_naira, months, sort_order) values
  ('monthly', 'Monthly', 5000, 1, 1),
  ('biannual', '6 Months', 30000, 6, 2),
  ('annual', '12 Months', 50000, 12, 3)
on conflict (id) do nothing;
