-- Stage 61 migration: run in the Supabase SQL editor after schema_stage60.
--
-- Several photos per product. Some things people sell (cars, property, furniture, a wedding
-- dress) cannot be shown well with one picture. A product now has an ordered list of photos,
-- `photos`, and the FIRST photo is the "cover".
--
-- products.photo_url is KEPT, and always equals the cover. Everything that reads one photo
-- (the catalogue grid, Jobtins, invoices, the older versions of this app) keeps working
-- unchanged, and only the places that want the whole gallery read `photos`.
--
-- Safe to run again.

alter table products add column if not exists photos jsonb not null default '[]'::jsonb;

-- A short list, never more than 8 photos, and always a list.
do $$
begin
  alter table products
    add constraint products_photos_is_short_list
    check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 8);
exception when duplicate_object then null;
end $$;

-- Every existing single photo becomes a one-photo list.
update products
   set photos = jsonb_build_array(photo_url)
 where photo_url is not null and photos = '[]'::jsonb;

-- Keeps photo_url and photos agreeing, whichever of them a writer changes:
--   * the app sets `photos`        -> photo_url becomes the first of them
--   * an OLDER app sets photo_url  -> that replaces (or removes) the first photo, and any others are kept
create or replace function sync_product_photos()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if jsonb_array_length(new.photos) = 0 then
      if new.photo_url is not null then
        new.photos := jsonb_build_array(new.photo_url);
      end if;
    else
      new.photo_url := new.photos ->> 0;
    end if;
  elsif new.photos is distinct from old.photos then
    new.photo_url := new.photos ->> 0;
  elsif new.photo_url is distinct from old.photo_url then
    if new.photo_url is null then
      new.photos := new.photos - 0;                      -- the cover was cleared: the next photo (if any) is the cover
    elsif jsonb_array_length(new.photos) = 0 then
      new.photos := jsonb_build_array(new.photo_url);
    else
      new.photos := jsonb_set(new.photos, '{0}', to_jsonb(new.photo_url));
    end if;
    new.photo_url := new.photos ->> 0;
  end if;
  return new;
end;
$$;

drop trigger if exists products_sync_photos on products;
create trigger products_sync_photos
  before insert or update on products
  for each row execute function sync_product_photos();

-- No storage changes are needed: the existing "Members upload/replace/delete product photos" policies
-- (schema_stage44.sql) only check that the file sits under {business_id}/products/..., and new photos are
-- stored at {business_id}/products/{product_id}/{random}.jpg, which is inside that.

notify pgrst, 'reload schema';
