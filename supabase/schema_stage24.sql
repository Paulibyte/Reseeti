-- Stage 24 migration: run in the Supabase SQL editor after schema_stage23
-- (or whatever your latest applied stage is).
--
-- Supports two of this stage's integrations: WhatsApp Business API
-- reminders, and Google Drive / Dropbox / OneDrive backups. The other
-- four (Bluetooth/USB printing, barcode/QR scanning) are entirely
-- browser-side — no schema needed for those. See README_STAGE24.md.

-- ---------- WhatsApp reminders ----------
-- Mirrors sms_reminders_enabled exactly (same on/off + shared
-- reminder_days_after) — a business can run SMS, WhatsApp, both, or
-- neither, and app/api/reminders/send/route.js's cron loop checks both
-- flags on every run.
alter table businesses add column if not exists whatsapp_reminders_enabled boolean not null default false;

-- ---------- Cloud backup connections ----------
-- One row per (business, provider) — a business can connect any subset
-- of the three providers simultaneously. access_token/refresh_token are
-- stored encrypted (see lib/crypto.js) — this table should never be
-- queried from client-side code, only from server-side API routes using
-- the admin client, and the app never returns these two columns to the
-- browser under any circumstance.
create table if not exists cloud_backup_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider text not null check (provider in ('google', 'dropbox', 'onedrive')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_backup_at timestamptz,
  last_backup_status text check (last_backup_status in ('success', 'failed')),
  last_backup_error text,
  unique (business_id, provider)
);

create index if not exists idx_cloud_backup_business on cloud_backup_connections(business_id);

alter table cloud_backup_connections enable row level security;

-- Owner-only, same as manageSettings elsewhere — connecting/disconnecting
-- a cloud account and triggering backups of the full business's data is
-- exactly the kind of thing staff roles shouldn't be able to do.
create policy "Owner manages their business's backup connections"
  on cloud_backup_connections for all
  using (
    business_id in (
      select business_id from business_members
      where user_id = auth.uid() and role = 'owner' and status = 'active'
    )
  )
  with check (
    business_id in (
      select business_id from business_members
      where user_id = auth.uid() and role = 'owner' and status = 'active'
    )
  );
