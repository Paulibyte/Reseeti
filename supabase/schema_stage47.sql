-- Stage 47 migration: run in the Supabase SQL editor after schema_stage46.
--
-- Catalogue-specific analytics — the last item from the original
-- catalogue proposal. Order-level stats (revenue, top items, WhatsApp
-- vs Pay Now split) are already fully derivable from catalogue_orders
-- (Stage 45), so the only genuinely new thing needed is page-view
-- tracking, which nothing captures yet.
--
-- Deliberately minimal: one row per page load, no session dedup, no
-- IP/user-agent capture. A refresh counts as a second view — a known,
-- accepted simplification for v1 rather than added complexity (a
-- cookie-based dedup, bot filtering, etc) for a number that's meant to
-- give a business a general sense of traffic, not survive an audit.
create table if not exists catalogue_views (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_catalogue_views_business_created
  on catalogue_views(business_id, created_at desc);

alter table catalogue_views enable row level security;

create policy "Members view their catalogue views"
  on catalogue_views for select
  using (business_id in (select my_active_business_ids()));

-- No insert policy for authenticated/anon roles — same reasoning as
-- catalogue_orders (Stage 45): a visitor loading the public catalogue
-- page has no Supabase session at all, so RLS has nothing to check.
-- The view gets recorded via the service-role client directly inside
-- app/shop/[slug]/page.js's own server-side render, best-effort (a
-- failed insert here should never break the page itself).
