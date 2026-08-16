-- Stage 39 migration: run in the Supabase SQL editor after schema_stage38.
--
-- Adds the public product catalogue + WhatsApp ordering module (Pro
-- feature). No new RLS policies needed:
--   - The public /shop/[slug] page reads via the service-role client
--     (lib/supabaseAdmin.js), same pattern as the existing public
--     receipt page (/inv/[id]) — it bypasses RLS entirely since a
--     visiting customer has no Supabase session at all.
--   - catalogue_slug/catalogue_enabled/whatsapp_number on `businesses`
--     and show_in_catalogue on `products` are just additional columns
--     on rows already covered by each table's existing owner/member
--     update policies (Stage 8) — nothing new to grant there.
alter table businesses add column if not exists catalogue_slug text unique;
alter table businesses add column if not exists catalogue_enabled boolean not null default false;
-- Deliberately separate from businesses.phone (the login/owner number) —
-- some shops run sales through a different line than whichever staff
-- member happens to be signed in, which is exactly why this is its own
-- field rather than reusing the login phone.
alter table businesses add column if not exists whatsapp_number text;

alter table products add column if not exists show_in_catalogue boolean not null default false;

create index if not exists idx_businesses_catalogue_slug on businesses(catalogue_slug) where catalogue_slug is not null;
