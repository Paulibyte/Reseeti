-- Stage 16 migration: run in the Supabase SQL editor after schema_stage15.sql
--
-- Two features bundled together because both are configured from the same
-- Business Settings screen and both touch invoice creation/reminders:
--
-- 1. Loyalty discounts: after a customer's Nth PAID invoice, future
--    invoices for them get an automatic percentage discount.
-- 2. SMS reminders: unpaid invoices get a real SMS (not just the existing
--    WhatsApp deep-link) sent automatically on a schedule.

-- ---------- 1. Loyalty ----------
alter table businesses add column if not exists loyalty_enabled boolean not null default false;
alter table businesses add column if not exists loyalty_purchase_threshold int not null default 10;
alter table businesses add column if not exists loyalty_discount_percent numeric(5,2) not null default 5;

-- Stored on the invoice itself (not just computed live from the current
-- business settings) so a historical invoice's numbers stay correct even
-- if the business later changes the threshold or percentage — same
-- reasoning as why VAT/service charge amounts were frozen onto the
-- invoice in Stage 15 rather than recalculated from current defaults.
alter table invoices add column if not exists loyalty_discount_applied boolean not null default false;
alter table invoices add column if not exists loyalty_discount_amount numeric(12,2) not null default 0;

-- ---------- 2. SMS reminders ----------
alter table businesses add column if not exists sms_reminders_enabled boolean not null default false;
-- How many days an invoice stays unpaid before it's due a reminder — and
-- also the minimum gap between repeat reminders for the same invoice, so
-- an invoice unpaid for a month gets nudged periodically rather than
-- either spammed daily or only ever reminded once.
alter table businesses add column if not exists reminder_days_after int not null default 3;

alter table invoices add column if not exists last_reminder_sent_at timestamptz;

-- No new RLS policies needed: the reminder-sending route runs as a
-- scheduled job (or an owner-triggered manual send) using the admin
-- client, not a normal authenticated user session — see
-- app/api/reminders/send/route.js.
