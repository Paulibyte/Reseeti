-- Stage 12 migration: run in the Supabase SQL editor after schema_stage11.sql
--
-- Expense tracking — fuel, transport, salary, rent, electricity, internet,
-- and a catch-all "other" category. This is what turns Analytics and
-- Reports from "here's what came in" into a real Profit = Sales − Expenses
-- view, i.e. an actual (small) accounting system rather than just an
-- invoicing log.

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  category text not null check (category in ('fuel', 'transport', 'salary', 'rent', 'electricity', 'internet', 'other')),
  description text,
  amount numeric(12,2) not null,
  expense_date date not null default current_date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_expenses_business_date on expenses(business_id, expense_date);

alter table expenses enable row level security;

-- Same pattern as customers/products/invoices since Stage 8: any active
-- member (owner or staff) can log and manage expenses. This is
-- operational record-keeping, not an account-level or billing action —
-- staff who buy fuel or pay for transport need to be able to log it
-- themselves without going through the owner.
create policy "Members manage expenses"
  on expenses for all
  using (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'))
  with check (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));
