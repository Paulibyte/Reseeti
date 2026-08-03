-- Stage 27 migration: run in the Supabase SQL editor after schema_stage26
-- (or whatever your latest applied stage is).
--
-- Covers the schema needed for: in-app feedback/bug reporting, the
-- onboarding walkthrough, and database migration/versioning tracking.
-- Error monitoring, legal pages, help/FAQ, import/export, and E2E
-- testing need no schema at all. See README_STAGE27.md.

-- ---------- In-app feedback & bug reporting ----------
-- No client read policy on purpose, same convention as `events` (Stage
-- 5) and `payment_events` (Stage 2) — feedback is written by the person
-- submitting it and read by you, the operator, not by other users of
-- the same business. app/api/feedback/route.js also emails it to you
-- directly via Resend, so the SQL editor is a backup/search tool, not
-- the only way to see a submission.
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('bug', 'idea', 'other')),
  message text not null,
  page_url text,
  screenshot_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_created on feedback(created_at desc);

alter table feedback enable row level security;

create policy "Members can submit feedback for their own business"
  on feedback for insert
  with check (
    business_id in (
      select business_id from business_members
      where user_id = auth.uid() and status = 'active'
    )
  );

-- ---------- Onboarding walkthrough ----------
-- One flag, not per-step tracking — the checklist itself infers which
-- steps are done from real data already on the business (logo set, a
-- product exists, a customer exists, an invoice exists), so the only
-- thing that needs storing is "did they dismiss the checklist," not a
-- record of each step.
alter table businesses add column if not exists onboarding_dismissed boolean not null default false;

-- ---------- Database migration/versioning ----------
-- Going forward, every schema_stageN.sql ends with an insert into this
-- table recording its own version — a lightweight version marker, not a
-- migration *runner* (there's still no tool here that applies files
-- automatically; you still paste each one into the SQL editor in order,
-- same as every stage before this one). What this buys you: a reliable
-- answer to "which migrations has this database actually had applied,"
-- checkable from the app itself (see the Diagnostics page addition in
-- this stage) instead of trying to infer it from which tables/columns
-- happen to exist.
create table if not exists schema_migrations (
  version int primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

alter table schema_migrations enable row level security;

create policy "Anyone signed in can see which migrations have run"
  on schema_migrations for select
  using (auth.role() = 'authenticated');

-- Backfill for every stage before this convention existed. Best-effort
-- on the exact history (applied_at defaults to "now," since there's no
-- way to know exactly when each one actually ran on your database) —
-- what matters is the version numbers themselves being on record from
-- here on.
insert into schema_migrations (version, name) values
  (1, 'schema'),
  (2, 'schema_stage2'),
  (3, 'schema_stage3'),
  (4, 'schema_stage4'),
  (5, 'schema_stage5'),
  (6, 'schema_stage6'),
  (7, 'schema_stage7'),
  (8, 'schema_stage8'),
  (10, 'schema_stage10'),
  (12, 'schema_stage12'),
  (13, 'schema_stage13'),
  (14, 'schema_stage14'),
  (15, 'schema_stage15'),
  (16, 'schema_stage16'),
  (17, 'schema_stage17'),
  (18, 'schema_stage18'),
  (19, 'schema_stage19'),
  (20, 'schema_stage20'),
  (21, 'schema_stage21'),
  (22, 'schema_stage22'),
  (23, 'schema_stage23'),
  (24, 'schema_stage24'),
  (25, 'schema_stage25'),
  (26, 'schema_stage26')
on conflict (version) do nothing;

insert into schema_migrations (version, name) values (27, 'schema_stage27')
on conflict (version) do nothing;
