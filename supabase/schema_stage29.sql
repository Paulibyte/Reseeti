-- Stage 29 migration: run in the Supabase SQL editor after schema_stage28
-- (or whatever your latest applied stage is).
--
-- Backs the new /admin dashboard: a platform-operator-only area (outside
-- any single business) for the two things that previously required
-- hand-editing tables in the Supabase Table Editor — the platform-wide
-- free-plan invoice limit, and per-business plan/limit overrides
-- (comping a business to Pro, granting a higher custom limit, etc).
--
-- Deliberately just a membership list, not a role/permission system like
-- business_members' — there's exactly one level of platform admin, and
-- adding tiers here before there's ever more than one or two operators
-- would be speculative complexity for no present need.
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text,
  created_at timestamptz default now()
);

alter table platform_admins enable row level security;

-- Deliberately NO policies at all — not even a "read your own row" one.
-- With RLS enabled and zero policies, every query against this table
-- from the anon/authenticated client keys returns empty, full stop.
-- "Who is a platform admin" must only ever be checked from server code
-- using the service_role client (lib/supabaseAdmin.js — see its own
-- file-level comment on why that key never reaches the browser), which
-- bypasses RLS entirely. This mirrors platform_settings' existing
-- "operator action, not a client-triggerable one" stance from Stage 26,
-- just taken one step further since this table controls who gets to
-- change that one.
--
-- Bootstrapping the first admin: there is deliberately no signup path
-- for this table — insert yourself manually once, after finding your
-- own auth.users id (Authentication > Users in the dashboard, or
-- `select id from auth.users where phone = '<your number>';`):
--
--   insert into platform_admins (user_id, label) values ('<your-user-id>', 'you');
