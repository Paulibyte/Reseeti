-- Stage 8 migration: run in the Supabase SQL editor after schema_stage6.sql
-- (Stage 7 was the OPay/Monnify gateway work — unrelated to this, and adds
-- no schema of its own, so this follows directly after Stage 6's tables.)
--
-- Up to now, "a business" and "a user" were the same thing — one
-- auth.users row = one businesses row, matched by businesses.user_id.
-- Every RLS policy in the app (invoices, invoice_items, customers,
-- products) was written against that assumption directly.
--
-- Multi-user staff accounts break that assumption on purpose: several
-- logins now need to reach the same business. Rather than bolt staff
-- access on top of the old model, this migration introduces a proper
-- membership table and REBUILDS every existing policy around it. Nothing
-- about invoices/customers/products/logins changes from the outside —
-- this is entirely a foundation change underneath them.

-- ---------- 1. Membership table ----------
create table if not exists business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade,
  phone text not null,
  label text, -- optional friendly name the owner assigns, e.g. "Ngozi — Cashier"
  role text not null default 'staff' check (role in ('owner', 'staff')),
  status text not null default 'invited' check (status in ('invited', 'active')),
  invited_at timestamptz default now(),
  joined_at timestamptz,
  unique (business_id, phone)
);

create index if not exists idx_business_members_user on business_members(user_id);

-- ---------- 2. Backfill: give every existing business owner a membership row ----------
-- Without this, rebuilding the policies below around business_members
-- would instantly lock every existing business out of its own data —
-- there'd be no membership row yet to grant them access.
insert into business_members (business_id, user_id, phone, role, status, joined_at)
select b.id, b.user_id, coalesce(b.phone, u.phone, 'unknown'), 'owner', 'active', b.created_at
from businesses b
join auth.users u on u.id = b.user_id
where not exists (
  select 1 from business_members bm where bm.business_id = b.id and bm.user_id = b.user_id
);

-- ---------- 3. Replace the signup trigger to support staff invites ----------
-- Previously: every new phone signup automatically got a brand new
-- business. Now: if the phone number that just signed up matches a
-- pending staff invite, attach them to that existing business instead of
-- creating a new one. Otherwise, behave exactly as before.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  pending record;
  new_business_id uuid;
begin
  select * into pending
  from business_members
  where phone = new.phone and status = 'invited' and user_id is null
  limit 1;

  if found then
    update business_members
    set user_id = new.id, status = 'active', joined_at = now()
    where id = pending.id;
  else
    insert into businesses (user_id, name, phone)
    values (new.id, 'My Business', new.phone)
    returning id into new_business_id;

    insert into business_members (business_id, user_id, phone, role, status, joined_at)
    values (new_business_id, new.id, new.phone, 'owner', 'active', now());
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- ---------- 4. Rebuild RLS around membership instead of direct ownership ----------

drop policy if exists "Users manage their own business" on businesses;
drop policy if exists "Users manage their own invoices" on invoices;
drop policy if exists "Users manage their own invoice items" on invoice_items;
drop policy if exists "Owner manages their customers" on customers;
drop policy if exists "Owner manages their products" on products;

create policy "Members can view their business"
  on businesses for select
  using (id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));

-- Deliberately owner-only: business name/logo/address are branding and
-- billing-adjacent settings, not day-to-day operational data. Staff get
-- full read access (they need to see the business name etc.) but can't
-- change it.
create policy "Owner can update their business"
  on businesses for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Members manage invoices"
  on invoices for all
  using (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'))
  with check (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));

create policy "Members manage invoice items"
  on invoice_items for all
  using (invoice_id in (
    select i.id from invoices i
    where i.business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active')
  ))
  with check (invoice_id in (
    select i.id from invoices i
    where i.business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active')
  ));

create policy "Members manage customers"
  on customers for all
  using (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'))
  with check (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));

create policy "Members manage products"
  on products for all
  using (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'))
  with check (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));

-- Membership itself: any active member can see their teammates (so staff
-- can at least see who else has access), but only the owner can invite,
-- change roles, or remove someone.
alter table business_members enable row level security;

create policy "Members can view their team"
  on business_members for select
  using (business_id in (select business_id from business_members bm2 where bm2.user_id = auth.uid() and bm2.status = 'active'));

create policy "Owner manages team invites"
  on business_members for insert
  with check (business_id in (select id from businesses where user_id = auth.uid()));

create policy "Owner updates team members"
  on business_members for update
  using (business_id in (select id from businesses where user_id = auth.uid()));

create policy "Owner removes team members"
  on business_members for delete
  using (business_id in (select id from businesses where user_id = auth.uid()));

-- ---------- 5. Note on tables intentionally left untouched ----------
-- payment_events and events: no client-facing RLS before this migration
-- (read via admin-client API routes scoped server-side), and none added
-- now. The API routes are updated separately (see README) to resolve
-- "which business does this signed-in user belong to" via
-- business_members instead of businesses.user_id directly, and to check
-- role where an action is owner-only (e.g. starting a Pro subscription).
--
-- storage.objects (logo uploads): left as owner-only on purpose — see
-- README for the reasoning.
