-- Stage 6 migration: run in the Supabase SQL editor after schema_stage5.sql
--
-- Two additions, both scoped to the existing single-owner-per-business
-- model (same as everything so far — this does not introduce multi-staff
-- access):
--   1. CRM: customers become real, persisted profiles instead of being
--      derived on the fly from invoice text fields.
--   2. Inventory: products with stock tracking, so selling an item can
--      actually decrement what you have left.

-- ---------- 1. Customers ----------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  name text not null,
  phone text,
  email text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (business_id, phone)
);

create index if not exists idx_customers_business on customers(business_id);

alter table customers enable row level security;

create policy "Owner manages their customers"
  on customers for all
  using (business_id in (select id from businesses where user_id = auth.uid()))
  with check (business_id in (select id from businesses where user_id = auth.uid()));

-- Link invoices to a real customer profile. Nullable and ON DELETE SET
-- NULL — deleting a customer profile should never delete their invoice
-- history, just detach it. customer_name/customer_phone stay on the
-- invoice too (unchanged), so old invoices keep working even without a
-- linked profile.
alter table invoices add column if not exists customer_id uuid references customers(id) on delete set null;
create index if not exists idx_invoices_customer on invoices(customer_id);

-- ---------- 2. Inventory ----------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  name text not null,
  barcode text,
  category text,
  price numeric(12,2) not null default 0,
  stock_qty numeric(12,2) not null default 0,
  low_stock_threshold numeric(12,2) not null default 5,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (business_id, barcode)
);

create index if not exists idx_products_business on products(business_id);
-- Powers the barcode lookup: type or scan a code into a search box and
-- find the matching product instantly, even with a large catalogue.
create index if not exists idx_products_barcode on products(business_id, barcode);

alter table products enable row level security;

create policy "Owner manages their products"
  on products for all
  using (business_id in (select id from businesses where user_id = auth.uid()))
  with check (business_id in (select id from businesses where user_id = auth.uid()));

-- Link invoice line items to a product. Nullable — an invoice can still
-- have free-text items that aren't tracked in inventory (e.g. a one-off
-- service charge), so this stays optional rather than mandatory.
alter table invoice_items add column if not exists product_id uuid references products(id) on delete set null;

-- ---------- 3. Automatic stock deduction ----------
-- When a line item referencing a product is inserted, decrement that
-- product's stock by the quantity sold. Implemented as a trigger (not
-- client-side code) so it fires no matter which code path writes the
-- item — the normal invoice form, the offline sync queue, or anything
-- added later — and so it can't be skipped by a bug in application code.
create or replace function public.deduct_stock_on_sale()
returns trigger as $$
begin
  if new.product_id is not null then
    update products
    set stock_qty = stock_qty - new.qty,
        updated_at = now()
    where id = new.product_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_invoice_item_created on invoice_items;
create trigger on_invoice_item_created
  after insert on invoice_items
  for each row execute procedure public.deduct_stock_on_sale();

-- Note: deliberately no corresponding "restock on delete" trigger yet —
-- invoices aren't currently deletable from the UI, so this hasn't been
-- needed. Worth adding alongside a delete-invoice feature if one is built.
