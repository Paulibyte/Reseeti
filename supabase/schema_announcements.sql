-- Admin-posted promotional/announcement banners, shown as a dismissible
-- floating message on the business dashboard. Managed from
-- /admin/settings, same page as the existing platform-wide settings.
--
-- No RLS policies are added deliberately (RLS stays enabled with zero
-- policies, same posture as other admin-only tables) — every read and
-- write goes through an API route using the service-role admin client,
-- with authorization enforced in code via isPlatformAdmin() for writes
-- and getMyBusinessId() for the one read a regular signed-in user can
-- make (app/api/announcements/active), exactly matching how
-- platform_settings is already handled. A row here should never be
-- reachable directly by a browser's own Supabase client.
create table platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  -- Both optional — an announcement can be informational only, with no
  -- button at all, if cta_label/cta_url are left null.
  cta_label text,
  cta_url text,
  -- 'all' (default), 'free', or 'pro' — lets the admin target an
  -- upgrade promo at free-plan businesses specifically, for instance,
  -- without every Pro business also seeing it.
  target_plan text not null default 'all' check (target_plan in ('all', 'free', 'pro')),
  -- Manually toggled off by the admin when a promo has run its course —
  -- no automatic expiry date, matching how simple the rest of the admin
  -- settings page already is.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table platform_announcements enable row level security;

create index idx_platform_announcements_active_created on platform_announcements(active, created_at desc);
