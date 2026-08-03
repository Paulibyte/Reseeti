-- Stage 10 migration: run in the Supabase SQL editor after schema_stage9.sql
--
-- Inventory Automation, part 2. Automatic stock deduction on sale already
-- exists (Stage 6's deduct_stock_on_sale trigger) and needed no changes.
-- This adds what was missing: profit calculation, which needs to know
-- what a product actually cost the business — and needs to remember that
-- cost *at the time of each sale*, not just look up today's cost, since
-- costs drift over time and last month's profit shouldn't silently change
-- because you updated a supplier price today.

-- ---------- 1. What a product costs to acquire ----------
-- Nullable and deliberately optional — a business owner may not always
-- know or want to enter this, and profit simply won't be calculable for
-- products without it. Better than forcing a fake number in.
alter table products add column if not exists cost_price numeric(12,2);

-- ---------- 2. Snapshot of that cost at the moment of each sale ----------
alter table invoice_items add column if not exists cost_price_at_sale numeric(12,2);

-- ---------- 3. Extend the existing stock-deduction trigger ----------
-- Same trigger from Stage 6 (deduct_stock_on_sale), CREATE OR REPLACE'd
-- rather than adding a second trigger — one thing happens on "an item
-- linked to a product got sold": stock goes down, and the cost at that
-- moment gets recorded. Keeping both in one trigger means every future
-- code path that inserts an invoice_item (the form, the offline sync
-- queue, anything added later) gets both behaviors automatically, with no
-- way to accidentally get one but not the other.
create or replace function public.deduct_stock_on_sale()
returns trigger as $$
begin
  if new.product_id is not null then
    update products
    set stock_qty = stock_qty - new.qty,
        updated_at = now()
    where id = new.product_id;

    update invoice_items
    set cost_price_at_sale = (select cost_price from products where id = new.product_id)
    where id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- The trigger itself (on_invoice_item_created, from Stage 6) doesn't need
-- to be recreated — CREATE OR REPLACE FUNCTION above updates its behavior
-- in place since Postgres triggers call the function by name.
