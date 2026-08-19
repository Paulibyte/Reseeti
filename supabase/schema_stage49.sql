-- Stage 49 migration: run in the Supabase SQL editor after schema_stage48.
--
-- Phase 2 of the service-business roadmap, step 1 of 6 — chosen first
-- specifically because it's the safest: a new column with a default
-- that makes every existing row (and every insert that doesn't
-- explicitly set it) behave byte-for-byte identically to before this
-- migration. Nothing about how products work today changes.
--
-- A "service" is just a product row where stock tracking is turned
-- off — same table, same RLS, same catalogue/invoice/photo machinery,
-- so a service gets everything a product already has (price, cost
-- price for margin, category, catalogue visibility, photo) for free.
-- The one thing that must NOT apply to a service is stock: it has no
-- physical quantity, so stock_qty stays 0 forever and every place that
-- currently reads stock_qty to decide "out of stock" needs to skip
-- that logic for a service — see the accompanying app-code changes in
-- this same delivery (ProductForm.jsx, inventory/page.js,
-- InvoiceForm.jsx, and app/shop/[slug]/ShopCart.jsx) for exactly where.
alter table products add column if not exists type text not null default 'product'
  check (type in ('product', 'service'));

-- The one behavioral change made at the database layer itself (not just
-- app code): a service should never actually have its stock_qty
-- decremented or get a stock_movements row on sale — those exist for
-- physical inventory, not a haircut or a consultation fee. Every
-- EXISTING product (type defaults to 'product') keeps going through this
-- function exactly as it always has; only a product explicitly marked as
-- a service takes the new early-return path.
create or replace function public.deduct_stock_on_sale()
returns trigger as $$
declare
  v_business_id uuid;
  v_created_by uuid;
  v_new_stock numeric(12,2);
  v_product_type text;
begin
  if new.product_id is not null then
    select type into v_product_type from products where id = new.product_id;

    if v_product_type = 'service' then
      return new;
    end if;

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
