-- Serialized inventory tracking for phone/laptop/electronics dealers —
-- each physical unit gets its own record (serial number, IMEI, color,
-- condition, which supplier it came from), rather than the plain
-- aggregate stock_qty every other product uses. Opt-in per product via
-- products.is_serialized, so a dealer's accessories/cases/chargers stay
-- as simple stock while phones/laptops/watches get full unit tracking.
--
-- Every RLS policy below is copied exactly from products' own
-- confirmed-live policy (verified directly via pg_policies before
-- writing this) — same business_id-via-business_members pattern, not
-- a new one invented for this feature.

alter table products add column is_serialized boolean not null default false;

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) not null,
  name text not null,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

alter table suppliers enable row level security;

create policy "Members manage suppliers" on suppliers for all
  using (business_id in (select business_members.business_id from business_members where business_members.user_id = auth.uid() and business_members.status = 'active'))
  with check (business_id in (select business_members.business_id from business_members where business_members.user_id = auth.uid() and business_members.status = 'active'));

-- A supplier can have more than one contact person (the owner, a sales
-- rep, an account officer) — kept as its own table rather than a
-- single name/phone pair on suppliers itself.
create table supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) not null,
  supplier_id uuid references suppliers(id) on delete cascade not null,
  name text not null,
  phone text,
  role text,
  created_at timestamptz not null default now()
);

alter table supplier_contacts enable row level security;

create policy "Members manage supplier contacts" on supplier_contacts for all
  using (business_id in (select business_members.business_id from business_members where business_members.user_id = auth.uid() and business_members.status = 'active'))
  with check (business_id in (select business_members.business_id from business_members where business_members.user_id = auth.uid() and business_members.status = 'active'));

-- One row per physical unit. imei1/imei2 (a dual-SIM phone has two)
-- are only ever populated for phones — laptops and watches simply
-- leave them null. specs is a free-text field deliberately, rather
-- than separate RAM/storage/screen-size columns, since what matters
-- differs by device type (storage+RAM for a phone, screen size for a
-- watch) and a dealer can just note whatever's relevant.
--
-- Sold status is deliberately NOT a column here — it's derived from
-- whether any invoice_items row references this unit (see the new
-- invoice_items.device_unit_id column below), so there's exactly one
-- source of truth for "has this been sold" rather than a flag that
-- could drift out of sync with the actual sale record.
create table device_units (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) not null,
  product_id uuid references products(id) not null,
  supplier_id uuid references suppliers(id),
  serial_number text not null,
  imei1 text,
  imei2 text,
  color text,
  condition text,
  specs text,
  cost_price numeric(12,2),
  created_at timestamptz not null default now()
);

alter table device_units enable row level security;

create policy "Members manage device units" on device_units for all
  using (business_id in (select business_members.business_id from business_members where business_members.user_id = auth.uid() and business_members.status = 'active'))
  with check (business_id in (select business_members.business_id from business_members where business_members.user_id = auth.uid() and business_members.status = 'active'));

-- Indexes on all three lookup fields — the whole point of the
-- dedicated Serial/IMEI Lookup tool is a fast search by any of them.
create index idx_device_units_serial on device_units(serial_number);
create index idx_device_units_imei1 on device_units(imei1);
create index idx_device_units_imei2 on device_units(imei2);
create index idx_device_units_product on device_units(product_id);

-- Links a specific sale to the exact physical unit sold — nullable,
-- since most invoice items are ordinary, non-serialized products.
-- Once this is set on any invoice_items row, that device_unit is
-- considered sold for every purpose in the app (the lookup tool, the
-- "available units" picker on a new invoice).
alter table invoice_items add column device_unit_id uuid references device_units(id);
