-- Stage 53 migration: run in the Supabase SQL editor after schema_stage52.
--
-- Phase 2, step 6 of 6 (the last one) — Recurring invoices. A saved
-- invoice template a daily cron job checks and, once due, turns into a
-- real invoice — same "real system cron hitting a CRON_SECRET-protected
-- route" pattern already confirmed working today for payment reminders
-- and the subscription expiry check (this app runs on a plain VPS, not
-- Vercel, which is why those needed a real crontab entry rather than
-- relying on a platform's built-in cron feature).
--
-- items is a self-contained JSON snapshot (description/qty/price), not
-- product-linked — a recurring bill is typically a subscription or
-- service charge, not physical stock being sold down, so no automatic
-- stock deduction applies here the way it does for a normal invoice.
create table if not exists recurring_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  customer_id uuid references customers(id) on delete set null,
  customer_name text not null,
  customer_phone text,
  items jsonb not null,
  discount numeric(12,2) not null default 0,
  due_days_after int, -- nullable — if set, the generated invoice's due_date is (generation date + this many days)
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_run_date date not null,
  active boolean not null default true,
  last_generated_invoice_id uuid references invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recurring_invoices_due
  on recurring_invoices(business_id, next_run_date) where active = true;

alter table recurring_invoices enable row level security;

create policy "Members manage recurring invoices" on recurring_invoices for all
  using (business_id in (select my_active_business_ids()))
  with check (business_id in (select my_active_business_ids()));
