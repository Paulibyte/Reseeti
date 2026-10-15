-- Minimal stand-ins for the tables/functions the migration depends on,
-- shaped from the real migrations (schema.sql, stage8, 15b, 28, 30, 49).
create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table businesses (id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id));
create table business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id), user_id uuid references auth.users(id),
  role text, status text default 'active', permission_overrides jsonb not null default '{}'::jsonb);
create table products (id uuid primary key default gen_random_uuid(), business_id uuid, name text, type text default 'product',
  stock_qty numeric(12,2) default 0, updated_at timestamptz);
create table invoices (
  id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id) not null,
  invoice_number text not null, customer_name text not null, total numeric(12,2) not null default 0,
  paid boolean not null default false, paid_at timestamptz, created_at timestamptz default now());
create table invoice_items (id uuid primary key default gen_random_uuid(), invoice_id uuid references invoices(id) on delete cascade not null,
  product_id uuid, description text, qty numeric(10,2) default 1, price numeric(12,2) default 0);
create table invoice_payments (id uuid primary key default gen_random_uuid(), invoice_id uuid references invoices(id) on delete cascade not null,
  method text not null check (method in ('cash','transfer','pos','card','ussd','other')),
  amount numeric(12,2) not null check (amount > 0), created_at timestamptz default now());
-- original inline CHECK, auto-named, exactly like Stage 30
create table stock_movements (
  id uuid primary key default gen_random_uuid(), business_id uuid not null, product_id uuid not null,
  change_qty numeric(12,2) not null,
  reason text not null check (reason in ('sale','restock','adjustment','correction')),
  invoice_id uuid references invoices(id) on delete set null, performed_by uuid, note text,
  resulting_stock_qty numeric(12,2), created_at timestamptz not null default now());
create table events (id uuid primary key default gen_random_uuid(), business_id uuid, user_id uuid, event_type text not null, metadata jsonb default '{}', created_at timestamptz default now());
create table schema_migrations (version int primary key, name text, applied_at timestamptz default now());
