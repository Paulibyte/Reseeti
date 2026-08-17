-- Stage 45 migration: run in the Supabase SQL editor after schema_stage44.
--
-- Closes the gap flagged when the catalogue module first shipped: the
-- WhatsApp message a customer sends WAS the order, but the seller had
-- to manually re-type it into an invoice with nothing to check against.
-- This records the same order as a real row the seller can see on their
-- dashboard and convert with one click — reusing the exact "resume a
-- draft into InvoiceForm" mechanism Park Sale already uses (see
-- app/dashboard/PendingOrdersPanel.jsx), rather than building a second
-- parallel way to get items into an invoice.
--
-- WhatsApp stays the actual communication channel between customer and
-- seller — nothing about that changes. This is purely an additional,
-- convenience record for the seller's own dashboard.
create table if not exists catalogue_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  customer_name text,
  customer_phone text not null,
  -- Snapshotted at order time (product_id, name, qty, price, unit,
  -- unit_value) rather than re-joined against products live — a price
  -- change after the order was placed shouldn't retroactively change
  -- what the customer was quoted. product_id is kept alongside the
  -- snapshot specifically so converting to an invoice can still link
  -- each line item back to real inventory (for stock deduction), the
  -- same way a normal invoice line item does.
  items jsonb not null,
  total numeric(12,2) not null check (total >= 0),
  status text not null default 'pending' check (status in ('pending', 'converted', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_catalogue_orders_business
  on catalogue_orders(business_id, status, created_at desc);

alter table catalogue_orders enable row level security;

-- Members can view and update (status changes — convert/dismiss) their
-- own business's orders, same access pattern as everything else a
-- member manages (products, customers, etc — Stage 8).
create policy "Members view catalogue orders"
  on catalogue_orders for select
  using (business_id in (select my_active_business_ids()));

create policy "Members update catalogue orders"
  on catalogue_orders for update
  using (business_id in (select my_active_business_ids()));

-- Deliberately NO insert policy for authenticated/anon roles — a
-- customer placing an order from the public catalogue has no Supabase
-- session at all, so RLS has nothing to authenticate against anyway.
-- Inserts only ever happen through /api/catalogue/orders, using the
-- service-role client after validating the order server-side (real
-- current prices, real products, matching business) — never trusting
-- anything the browser submits directly into this table.
