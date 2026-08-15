-- Stage 33 migration: run in the Supabase SQL editor after schema_stage32
-- (or whatever your latest applied stage is).
--
-- Reseeti moved from one flat ₦1,500/month Pro price to three tiers
-- (monthly/6-month/12-month — see lib/planTiers.js). This column records
-- which one a business is currently on, purely for display (Payments
-- page, admin dashboard) — plan_renews_at (already existed) is still
-- what actually gates access; this doesn't change that logic at all.
alter table businesses add column if not exists plan_interval text
  check (plan_interval in ('monthly', 'biannual', 'annual'));
