-- Stage 30 migration: run in the Supabase SQL editor after schema_stage29
-- (or whatever your latest applied stage is).
--
-- Two additions, both from the Inventory reviewer feedback:
--   1. Variants — a "50kg bag" and "25kg bag" of the same item ("Rice")
--      can now be modeled as one product family instead of two
--      unrelated, same-named rows.
--   2. Stock movement history — every stock change (a sale, a manual
--      restock, a correction) is now logged with who did it and when,
--      instead of the Stage 6 trigger silently decrementing stock_qty
--      with no trace.

-- ==================================================================
-- PART 1 — Who created an invoice
-- ==================================================================
-- Never captured before this stage. Needed for Part 2 below — a stock
-- movement caused by a sale can only record "who sold it" if the
-- invoice itself remembers who created it. Nullable and ON DELETE SET
-- NULL: losing this if a user account is ever deleted should never
-- threaten the invoice record itself.
alter table invoices add column if not exists created_by uuid references auth.users(id) on delete set null;

-- ==================================================================
-- PART 2 — Product variants
-- ==================================================================
-- unit/unit_value describe the variant itself (e.g. unit='kg',
-- unit_value=50 for "50kg bag"); free-text unit rather than a fixed
-- enum since businesses' units genuinely differ (kg/g/l/ml/pcs/bag/
-- carton/dozen/yard/...) and a hardcoded list would just mean editing
-- this migration every time a new trade needs one.
alter table products add column if not exists unit text;
alter table products add column if not exists unit_value numeric(12,3);

-- family_id groups variants of the same underlying item together —
-- "Rice 25kg" and "Rice 50kg" share a family_id so the Inventory page
-- can display and manage them as one product with size options, while
-- each variant keeps its own price and stock_qty (they're genuinely
-- separate stock — selling one bag size doesn't touch the other's
-- count). Self-referencing rather than a separate "product_families"
-- table: with no family-level attributes of its own (name/description
-- already live on the first/primary variant), a whole extra table
-- would be unused structure for no present need.
alter table products add column if not exists family_id uuid references products(id) on delete set null;

-- A standalone product (no variants) is its own one-member family — so
-- family_id is never left null, and "all variants of this item" is
-- always just `where family_id = <either variant's family_id>` with no
-- special-casing for the standalone case. BEFORE INSERT (not a default
-- expression) because the default value for `id` itself must already be
-- computed before this can reference it, and Postgres evaluates column
-- defaults before BEFORE triggers run, so new.id is already populated
-- here.
create or replace function public.default_product_family()
returns trigger as $$
begin
  if new.family_id is null then
    new.family_id := new.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_product_default_family on products;
create trigger on_product_default_family
  before insert on products
  for each row execute procedure public.default_product_family();

-- Backfill: every product that already exists becomes its own
-- one-member family, same as a newly-created standalone product would.
update products set family_id = id where family_id is null;

create index if not exists idx_products_family on products(family_id);

-- ==================================================================
-- PART 3 — Stock movement history
-- ==================================================================
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  -- Negative for anything that reduces stock (a sale), positive for
  -- anything that adds it (a restock) — one signed column rather than
  -- separate qty_in/qty_out, so "current stock" is always just the
  -- running sum of this column for a product.
  change_qty numeric(12,2) not null,
  reason text not null check (reason in ('sale', 'restock', 'adjustment', 'correction')),
  invoice_id uuid references invoices(id) on delete set null,
  performed_by uuid references auth.users(id) on delete set null,
  note text,
  resulting_stock_qty numeric(12,2),
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_product on stock_movements(product_id, created_at desc);
create index if not exists idx_stock_movements_business on stock_movements(business_id, created_at desc);

alter table stock_movements enable row level security;

-- Same access pattern as products/customers/invoices since Stage 8: any
-- active member can view their business's stock history — this is
-- operational record-keeping, not an owner-only report.
create policy "Members view stock movements"
  on stock_movements for select
  using (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));

-- Manual entries (restock/adjustment/correction, from the Inventory
-- page) insert as the signed-in member directly — performed_by is
-- pinned to auth.uid() in the check, so nobody can log a stock change
-- under someone else's name. Automatic 'sale' entries never go through
-- this policy at all; they're written by the trigger below via
-- security definer, same as the stock deduction itself already was.
create policy "Members log manual stock changes"
  on stock_movements for insert
  with check (
    business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active')
    and performed_by = auth.uid()
    and reason in ('restock', 'adjustment', 'correction')
  );

-- The Inventory page's "Restock" / "Adjust stock" action calls this
-- rather than issuing two separate client requests (update products,
-- then insert stock_movements) — two people adjusting the same
-- product's stock at the same moment could otherwise both read the old
-- stock_qty and overwrite each other's change. Wrapping both writes in
-- one function keeps them atomic. security definer so the update can
-- happen regardless of the RLS specifics on `products`, but the
-- business-membership check below stands in for what RLS would have
-- enforced anyway, so this grants no more access than the app already
-- has through the UI.
create or replace function public.log_manual_stock_movement(
  p_product_id uuid,
  p_change_qty numeric,
  p_reason text,
  p_note text default null
)
returns numeric
language plpgsql
security definer
as $$
declare
  v_business_id uuid;
  v_new_stock numeric(12,2);
begin
  if p_reason not in ('restock', 'adjustment', 'correction') then
    raise exception 'Invalid reason for a manual stock movement: %', p_reason;
  end if;

  select business_id into v_business_id from products where id = p_product_id;
  if v_business_id is null then
    raise exception 'Product not found';
  end if;

  if not exists (
    select 1 from business_members
    where business_id = v_business_id and user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'Not authorized for this business';
  end if;

  update products
  set stock_qty = stock_qty + p_change_qty, updated_at = now()
  where id = p_product_id
  returning stock_qty into v_new_stock;

  insert into stock_movements (business_id, product_id, change_qty, reason, performed_by, note, resulting_stock_qty)
  values (v_business_id, p_product_id, p_change_qty, p_reason, auth.uid(), p_note, v_new_stock);

  return v_new_stock;
end;
$$;

grant execute on function public.log_manual_stock_movement(uuid, numeric, text, text) to authenticated;

-- ---------- Extend the Stage 6 sale-deduction trigger ----------
-- Same trigger, same firing condition (an invoice_item referencing a
-- product), now also writing the audit trail Part 3 introduces. Kept as
-- one trigger rather than two separate ones so the stock_qty update and
-- its corresponding movement log entry can never drift apart — either
-- both happen or (on an error) neither does, in the same transaction
-- the invoice_item insert itself is part of.
create or replace function public.deduct_stock_on_sale()
returns trigger as $$
declare
  v_business_id uuid;
  v_created_by uuid;
  v_new_stock numeric(12,2);
begin
  if new.product_id is not null then
    update products
    set stock_qty = stock_qty - new.qty,
        updated_at = now()
    where id = new.product_id
    returning stock_qty into v_new_stock;

    select business_id, created_by into v_business_id, v_created_by
    from invoices where id = new.invoice_id;

    insert into stock_movements
      (business_id, product_id, change_qty, reason, invoice_id, performed_by, resulting_stock_qty)
    values
      (v_business_id, new.product_id, -new.qty, 'sale', new.invoice_id, v_created_by, v_new_stock);
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- Trigger itself is unchanged (still on_invoice_item_created, still
-- AFTER INSERT) — only the function body above changed, so no
-- drop/recreate needed for the trigger itself, just the function.
