-- Admin-managed content for the public Help page's new Documents and
-- Video Tutorials sections, alongside the existing hardcoded FAQ.
-- Managed from /admin/tutorials.
--
-- Same posture as platform_announcements: RLS enabled with zero
-- policies, every read/write goes through an API route using the
-- service-role admin client, authorization enforced in code
-- (isPlatformAdmin for writes, no auth needed for the public read since
-- the Help page itself has no login wall).
create table help_tutorials (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('doc', 'video')),
  category text not null,
  title text not null,
  -- Doc body (basic formatting only — see lib/simpleMarkdown.js) for
  -- type='doc'. For type='video', an optional short description shown
  -- above the embedded player; null is fine.
  content text,
  -- Only set for type='video' — the raw URL as pasted from YouTube, in
  -- whatever format (watch?v=, youtu.be/, already an embed link).
  -- Normalized to an embeddable form at render time, not stored
  -- pre-normalized, so a stored row still makes sense to a human
  -- reading the table directly.
  youtube_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table help_tutorials enable row level security;

create index idx_help_tutorials_active_type on help_tutorials(active, type, category);
