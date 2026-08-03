-- Reseeti database schema
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query)

-- 1. Businesses (one per signed-up user)
create table businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  name text not null,
  phone text,
  address text,
  logo_url text,
  plan text not null default 'free', -- 'free' | 'pro'
  plan_renews_at timestamptz,
  created_at timestamptz default now()
);

-- 2. Invoices
create table invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  invoice_number text not null,
  customer_name text not null,
  customer_phone text,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz default now()
);

-- 3. Invoice line items
create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade not null,
  description text not null,
  qty numeric(10,2) not null default 1,
  price numeric(12,2) not null default 0,
  sort_order int not null default 0
);

-- Helpful index: fast lookup of "how many invoices this month" for the free-tier limit
create index idx_invoices_business_created on invoices(business_id, created_at);

-- ---------- Row Level Security ----------
-- Ensures a business can only ever see/edit its own rows, enforced at the database level
-- (not just in app code), which matters once you have a public API surface.

alter table businesses enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;

create policy "Users manage their own business"
  on businesses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own invoices"
  on invoices for all
  using (business_id in (select id from businesses where user_id = auth.uid()))
  with check (business_id in (select id from businesses where user_id = auth.uid()));

create policy "Users manage their own invoice items"
  on invoice_items for all
  using (invoice_id in (
    select i.id from invoices i
    join businesses b on b.id = i.business_id
    where b.user_id = auth.uid()
  ))
  with check (invoice_id in (
    select i.id from invoices i
    join businesses b on b.id = i.business_id
    where b.user_id = auth.uid()
  ));

-- ---------- Auto-create a business row when someone signs up ----------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.businesses (user_id, name)
  values (new.id, 'My Business');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
