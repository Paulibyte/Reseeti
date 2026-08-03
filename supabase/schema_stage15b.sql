-- Stage 15 migration: run in the Supabase SQL editor after schema_stage14.sql
--
-- Two features bundled together because they touch the same invoice math:
--
-- 1. POS-style payment recording: Cash, Transfer, POS, Card, USSD — and
--    SPLIT payments (a sale paid partly cash, partly transfer, etc).
--    Stage 14 introduced a single invoices.payment_method column, fine
--    for "how was this one paid" but with no way to represent "half in
--    cash, half by transfer." This adds a proper invoice_payments table
--    for that, while keeping payment_method as a quick-glance summary
--    column (holds the single method, or the sentinel 'split').
--
-- 2. VAT / Service charge / Shipping / Withholding tax — the charges a
--    real Nigerian invoice needs beyond subtotal/discount. Stored as
--    amounts (not just rates) on the invoice itself, so an invoice's
--    numbers stay frozen even if a business changes their default VAT
--    rate next year.

-- ---------- 1. Business-level defaults ----------
-- Prefill invoice creation; each invoice can still override before
-- saving. VAT off by default (not every business is VAT-registered);
-- 7.5% is the current FIRS standard rate when enabled.
alter table businesses add column if not exists vat_enabled boolean not null default false;
alter table businesses add column if not exists default_vat_rate numeric(5,2) not null default 7.5;
alter table businesses add column if not exists service_charge_enabled boolean not null default false;
alter table businesses add column if not exists default_service_charge_rate numeric(5,2) not null default 0;
alter table businesses add column if not exists withholding_tax_enabled boolean not null default false;
alter table businesses add column if not exists default_withholding_tax_rate numeric(5,2) not null default 0;

-- ---------- 2. Extra charges on the invoice itself ----------
-- Stored as both the rate actually used AND the resulting amount, so a
-- historical invoice keeps showing what was true when it was issued,
-- independent of any later change to the business's default rates.
alter table invoices add column if not exists service_charge_rate numeric(5,2) not null default 0;
alter table invoices add column if not exists service_charge_amount numeric(12,2) not null default 0;
alter table invoices add column if not exists vat_rate numeric(5,2) not null default 0;
alter table invoices add column if not exists vat_amount numeric(12,2) not null default 0;
alter table invoices add column if not exists shipping_fee numeric(12,2) not null default 0;
alter table invoices add column if not exists withholding_tax_rate numeric(5,2) not null default 0;
alter table invoices add column if not exists withholding_tax_amount numeric(12,2) not null default 0;

-- Existing invoices simply get zero for all of these — their `total` is
-- untouched and remains correct as-is; this only affects invoices created
-- from this point forward.

-- ---------- 3. Split payments ----------
create table if not exists invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references invoices(id) on delete cascade not null,
  method text not null check (method in ('cash', 'transfer', 'pos', 'card', 'ussd', 'other')),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz default now()
);

create index if not exists idx_invoice_payments_invoice on invoice_payments(invoice_id);

alter table invoice_payments enable row level security;

-- Same join-through-invoices pattern Stage 8 used for invoice_items,
-- since invoice_payments has no business_id column of its own.
create policy "Members manage invoice payments"
  on invoice_payments for all
  using (invoice_id in (
    select i.id from invoices i
    where i.business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active')
  ))
  with check (invoice_id in (
    select i.id from invoices i
    where i.business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active')
  ));

-- Migrate Stage 14's old method values to the new POS-style vocabulary —
-- 'bank_transfer' becomes 'transfer' ('card' already matches; anything
-- else that was previously 'other' stays 'other'). This only affects the
-- summary column; no invoice_payments rows exist yet for pre-Stage-15
-- invoices, since that table is brand new.
update invoices set payment_method = 'transfer' where payment_method = 'bank_transfer';
