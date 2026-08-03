-- Stage 2 migration: run this in the Supabase SQL editor after schema.sql
-- Adds what's needed to bill via Paystack subscriptions.

alter table businesses add column if not exists email text;
alter table businesses add column if not exists paystack_customer_code text;
alter table businesses add column if not exists paystack_subscription_code text;

-- A log of payment events is worth keeping even in an MVP — it's the first
-- place you'll look when a business says "I paid but I'm still on Free."
create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete set null,
  event_type text not null,
  reference text,
  amount numeric(12,2),
  raw_payload jsonb,
  created_at timestamptz default now()
);

alter table payment_events enable row level security;
-- No user-facing policy on purpose: this table is only written/read by the
-- webhook using the service-role key, never by client code.
