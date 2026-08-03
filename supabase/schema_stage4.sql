-- Stage 4 migration: run in the Supabase SQL editor after schema_stage2.sql

alter table invoices add column if not exists last_reminded_at timestamptz;

-- ---------- Logo storage ----------
-- A public bucket: logos need to be viewable by anyone who opens a shared
-- invoice link (no login), but only the owning business can upload/replace
-- its own logo.

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "Anyone can view logos"
  on storage.objects for select
  using (bucket_id = 'logos');

create policy "Business uploads its own logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (
      select id::text from businesses where user_id = auth.uid()
    )
  );

create policy "Business replaces its own logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (
      select id::text from businesses where user_id = auth.uid()
    )
  );

-- Expected upload path convention: logos/{business_id}/logo.png
-- The (storage.foldername(name))[1] check above is what enforces that a
-- business can only ever write into its own folder within the bucket.
