-- Stage 15 migration: run in the Supabase SQL editor after schema_stage14.sql
--
-- Adds a platform administrator panel — a tier above business owners,
-- for Reseeti's own team to view all businesses and override plan/limits.

-- ---------- 1. Platform admins ----------
-- A short list of Reseeti staff, entirely separate from any business's own
-- owner/staff roles (business_members, from schema_stage8.sql). No RLS
-- policies are added here on purpose: that means the normal
-- anon/authenticated client can never read or write this table at all,
-- only the service-role admin client — which is only ever used from
-- server-side code that has already confirmed the caller is signed in
-- (see lib/getPlatformAdmin.js). A business owner has no way to read or
-- forge their way into this table from the browser.
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;

-- ---------- 2. Platform-wide settings (singleton row) ----------
-- Currently just the default free-plan monthly invoice limit. The `id
-- boolean primary key` + check constraint is a standard Postgres trick to
-- guarantee this table only ever has exactly one row (id must be `true`).
create table if not exists platform_settings (
  id boolean primary key default true,
  free_plan_invoice_limit integer not null default 5,
  updated_at timestamptz not null default now(),
  constraint platform_settings_singleton check (id)
);
insert into platform_settings (id) values (true) on conflict (id) do nothing;

alter table platform_settings enable row level security;

-- Readable by anyone signed in — the free-plan limit number itself isn't
-- sensitive, and every business's own dashboard needs to read it to show
-- "X/Y free invoices used." Only the admin client can write it (no
-- insert/update/delete policy is added), via the /admin panel.
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'platform_settings' and policyname = 'platform_settings_readable'
  ) then
    create policy "platform_settings_readable" on platform_settings for select using (true);
  end if;
end $$;

-- ---------- 3. Per-business invoice limit override ----------
-- Null (the default for every existing and new business) means "use
-- platform_settings.free_plan_invoice_limit" — most businesses will never
-- have this set individually. Only meaningful while plan = 'free'; a Pro
-- business already has no limit.
alter table businesses add column if not exists monthly_invoice_limit integer;

-- ---------- Bootstrapping your first admin ----------
-- There's deliberately no self-serve way to become the first admin (that
-- would be a security hole). Sign in to the app normally once (so an
-- auth.users row exists for you), find your User UID in the Supabase
-- dashboard under Authentication > Users, then run:
--
--   insert into platform_admins (user_id, label) values ('<your-user-uid>', 'Founder');
--
-- After that, you can add further admins from inside the /admin panel
-- itself.
