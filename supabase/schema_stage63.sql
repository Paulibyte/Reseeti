-- Stage 63 migration: run in the Supabase SQL editor after schema_stage62.
--
-- 1. WHOLESALE SELLING. A product can be sold by the bag, carton or crate with a minimum order and cheaper prices for
--    larger quantities (see lib/wholesalePricing.js for the exact rules):
--      sale_mode    'retail' (the default: nothing changes for any existing product), 'wholesale' or 'both'
--      moq          the smallest quantity that can be ordered (wholesale only)
--      price_tiers  [{ "min_qty": 10, "price": 9500 }, ...] at most 4, cheaper as the quantity grows
--      price_updated_at  when the price (or a bulk price) last changed. Shown to buyers because food prices move often. It is
--                   blank for existing products until their price next changes (nothing is guessed, and no existing product
--                   row is touched by this file, so no product's updated_at is re-stamped).
--
-- 2. A THIRD MARKETPLACE SWITCH: "List on Owerri Food Market" (a food and drinks marketplace), separate from Jobtins and
--    HomeEase Nigeria, OFF for every business until its owner chooses (same rules as schema_stage62.sql).
--
-- Safe to run more than once.

alter table products add column if not exists sale_mode text not null default 'retail';
alter table products add column if not exists moq integer not null default 1;
alter table products add column if not exists price_tiers jsonb not null default '[]'::jsonb;

-- price_updated_at: added WITHOUT a value for the products that already exist (blank means "not known"), then given a default so
-- every product added from now on starts with a date. No existing row is updated, which matters because every update of a product
-- row re-stamps its updated_at (trg_products_updated_at), and that stamp is what Reseeti uses to spot clashing offline edits.
alter table products add column if not exists price_updated_at timestamptz;
alter table products alter column price_updated_at set default now();

do $$ begin
  alter table products add constraint products_sale_mode_valid check (sale_mode in ('retail', 'wholesale', 'both'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table products add constraint products_moq_valid check (moq between 1 and 1000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table products add constraint products_price_tiers_valid check (jsonb_typeof(price_tiers) = 'array' and jsonb_array_length(price_tiers) <= 4);
exception when duplicate_object then null; end $$;

-- The date moves only when the price, or a bulk price, really changes.
create or replace function touch_price_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.price is distinct from old.price or new.price_tiers is distinct from old.price_tiers then
    new.price_updated_at := now();
  end if;
  return new;
end;
$$;

-- (Created only if it is not there yet, instead of dropped and recreated, so the editor has nothing to warn about.)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'products_touch_price_updated_at' and tgrelid = 'products'::regclass) then
    create trigger products_touch_price_updated_at
      before update on products
      for each row execute function touch_price_updated_at();
  end if;
end $$;

-- The third marketplace switch (off for everyone, with the date the owner agreed).
alter table businesses add column if not exists foodmarket_opt_in boolean not null default false;
alter table businesses add column if not exists foodmarket_opt_in_at timestamptz;

insert into schema_migrations (version, name) values (63, 'schema_stage63')
on conflict (version) do nothing;
