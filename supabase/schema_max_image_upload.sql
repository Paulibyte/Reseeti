-- Replaces the hardcoded image-size limits scattered across the app
-- (2MB for product photos, business logo, and signature; 5MB for the
-- AI receipt scanner) with one admin-configurable value. Deliberately
-- unified into a single setting rather than one per upload point —
-- simpler for an admin to manage, and matches how this was actually
-- requested. If a genuine need to differentiate receipt scans from
-- other images shows up later, that's a small, separate addition.
alter table platform_settings add column max_image_upload_mb integer not null default 2;
