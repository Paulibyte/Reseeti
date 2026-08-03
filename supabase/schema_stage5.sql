-- Stage 5 migration: run in the Supabase SQL editor after schema_stage4.sql

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists idx_events_type_created on events(event_type, created_at);

alter table events enable row level security;

-- Any signed-in user can write an event, but only tagged with their own
-- user_id — prevents one user from writing events attributed to someone
-- else. Reading is intentionally NOT exposed to the client at all; you
-- (the app owner) query this table directly in the Supabase SQL editor
-- or dashboard using your own account, not through the app's anon key.
create policy "Signed-in users can log their own events"
  on events for insert
  with check (auth.uid() = user_id or user_id is null);

-- ---------- A few starter queries worth keeping handy ----------
-- (Not run automatically — paste into the SQL editor when you want them.)
--
-- Invoices created per day, last 30 days:
--   select date_trunc('day', created_at) as day, count(*)
--   from events where event_type = 'invoice_created'
--   and created_at > now() - interval '30 days'
--   group by 1 order by 1;
--
-- Where people actually click, ranked:
--   select event_type, count(*) from events group by 1 order by 2 desc;
--
-- Free-to-Pro conversion clicks vs actual upgrades this month:
--   select event_type, count(*) from events
--   where event_type in ('upgrade_clicked', 'upgrade_completed')
--   and created_at > date_trunc('month', now())
--   group by 1;
