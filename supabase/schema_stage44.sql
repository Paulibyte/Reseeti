-- Stage 44 migration: run in the Supabase SQL editor after schema_stage43.
--
-- Product photos for the catalogue (previously held for a later stage —
-- see schema_stage39.sql's comments). Reuses the existing 'logos'
-- public bucket (schema_stage4.sql) rather than creating a new one —
-- same reasoning already used for the signature image: the storage RLS
-- policies only check the business_id folder, not the filename, so a
-- products/ subfolder is a legitimate reuse, not a workaround.
--
-- Deliberately NOT reusing schema_stage4.sql's existing logo policies,
-- though — those are scoped to `businesses.user_id = auth.uid()`, i.e.
-- owner-only, which was the right call for business-identity settings
-- (logo, signature) but wrong for product photos: Inventory management
-- (including, now, product photos) is already available to Owner AND
-- Manager roles (lib/permissions.js's manageInventory), matching the
-- existing "Members manage products" policy on the products table
-- itself (Stage 8) — so these new policies check active membership via
-- my_active_business_ids() instead, not raw ownership.
alter table products add column if not exists photo_url text;

create policy "Members upload product photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[2] = 'products'
    and (storage.foldername(name))[1]::uuid in (select my_active_business_ids())
  );

create policy "Members replace product photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[2] = 'products'
    and (storage.foldername(name))[1]::uuid in (select my_active_business_ids())
  );

create policy "Members delete product photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[2] = 'products'
    and (storage.foldername(name))[1]::uuid in (select my_active_business_ids())
  );

-- Expected upload path convention: logos/{business_id}/products/{product_id}.{ext}
-- — the bucket's existing "Anyone can view logos" SELECT policy
-- (Stage 4) already covers reading these, since it only checks
-- bucket_id, not the path — no new SELECT policy needed for the public
-- catalogue page to display them.
