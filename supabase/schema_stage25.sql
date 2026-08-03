-- Stage 25 migration: run in the Supabase SQL editor after schema_stage24
-- (or whatever your latest applied stage is).
--
-- Covers the schema needed for: rate limiting, device management, login
-- alerts, and audit/activity logging (which reuses the existing `events`
-- table from Stage 5 — no schema change needed there, just new
-- event_type values and a server-side route to read it). Two-factor
-- authentication, session management, and webhook signature hardening
-- need no schema at all — 2FA and session scope-control are entirely
-- Supabase Auth's own built-in features (auth.mfa_factors,
-- auth.signOut({scope})), and webhook hardening is a code-only change.
-- CSRF protection and encrypted local storage are also schema-free
-- (cookie- and browser-storage-based respectively). See
-- README_STAGE25.md for the full picture.

-- ---------- Rate limiting ----------
-- One row per (key, window) — `key` is caller-defined, typically
-- "route:identifier" (e.g. "ai-insights:<business_id>" or
-- "login-event:<ip>"), so the same table serves every rate-limited route
-- in the app rather than needing one table per route.
create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

-- Does the read-check-increment atomically in one round trip — critical
-- under concurrent requests, since two simultaneous calls both reading
-- "count = 4" in JS and both writing "count = 5" would let a limit of 5
-- silently become 6. Postgres's row-level locking inside one statement
-- closes that race in a way plain JS read-then-write can't.
create or replace function increment_rate_limit(p_key text, p_window_seconds int, p_max_count int)
returns table(allowed boolean, current_count int) as $$
declare
  v_window_start timestamptz;
  v_count int;
begin
  insert into rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case
      when rate_limits.window_start < now() - (p_window_seconds || ' seconds')::interval
        then 1
      else rate_limits.count + 1
    end,
    window_start = case
      when rate_limits.window_start < now() - (p_window_seconds || ' seconds')::interval
        then now()
      else rate_limits.window_start
    end
  returning rate_limits.count into v_count;

  return query select (v_count <= p_max_count), v_count;
end;
$$ language plpgsql;

-- ---------- Device tracking (for the Security page's device list + login alerts) ----------
-- Deliberately NOT a live "active sessions" table — Supabase Auth doesn't
-- expose per-session listing to the client, so this can't be a true
-- kill-switch per device (see README_STAGE25.md). It's a record of
-- "which devices/browsers have signed in and when," used to show that
-- list and to detect "this is a device we haven't seen before" for login
-- alerts. device_id is a random id the browser generates for itself on
-- first login and keeps in localStorage — not a hardware fingerprint,
-- just a stable per-browser-profile identifier.
create table if not exists user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  device_id text not null,
  label text,
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create index if not exists idx_user_devices_user on user_devices(user_id);

alter table user_devices enable row level security;

create policy "Users manage their own device list"
  on user_devices for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Login alerts ----------
-- Per-member, not per-business — each person on a shared business
-- account decides for themselves whether they want a text when their own
-- account signs in somewhere new, same as most consumer apps.
alter table business_members add column if not exists login_alerts_enabled boolean not null default true;
