-- Stage 13 migration: run in the Supabase SQL editor after schema_stage12.sql
--
-- Cashbook — the single most requested bookkeeping format among Nigerian
-- traders: a running ledger of Cash In / Cash Out entries with a running
-- Balance, exactly like the physical exercise books most shop owners
-- already keep by hand.
--
-- Deliberately its own standalone ledger, not auto-derived from
-- invoices/expenses (same scope decision as Stage 12's Expenses, which
-- also doesn't auto-link to Sales despite the obvious overlap): not every
-- paid invoice is a *cash* payment, and not every expense is paid in
-- *cash* either (transfers, POS, credit). Auto-deriving would silently
-- mix cash and non-cash movements into what's supposed to be a literal
-- "how much physical cash do I have" figure. A quick-add flow makes
-- manual entry fast enough that this isn't a real burden — see the app
-- side of this stage.

-- ---------- 1. Opening balance ----------
-- The cash on hand at the moment a business starts using the Cashbook —
-- everything after this is purely additive from logged entries. One
-- number per business, not per period: the running balance naturally
-- carries forward day to day, so there's no need to snapshot an
-- opening/closing balance per day the way a paper cashbook does — that
-- would just be redundant with (opening_balance + entries so far).
alter table businesses add column if not exists cashbook_opening_balance numeric(12,2) not null default 0;

-- ---------- 2. The ledger itself ----------
create table if not exists cashbook_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  type text not null check (type in ('in', 'out')),
  amount numeric(12,2) not null check (amount > 0),
  description text,
  entry_date date not null default current_date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_cashbook_entries_business_date on cashbook_entries(business_id, entry_date);

alter table cashbook_entries enable row level security;

-- Same access pattern as expenses/customers/products/invoices (Stage 8):
-- any active member can log cash movements day to day.
create policy "Members manage cashbook entries"
  on cashbook_entries for all
  using (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'))
  with check (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));

-- Opening balance is the exception: changing it can retroactively shift
-- every running balance shown across the whole ledger, which makes it a
-- much easier way to quietly paper over a shortfall than any individual
-- entry would be. It lives on businesses, not cashbook_entries, so it's
-- already covered by Stage 8's "Owner can update their business" policy
-- (using/with check user_id = auth.uid()) — meaning owner-only enforcement
-- here comes for free at the database level, with no new policy needed.
-- The app additionally only renders the edit control for role === 'owner',
-- so staff never even see an option that would fail anyway.
