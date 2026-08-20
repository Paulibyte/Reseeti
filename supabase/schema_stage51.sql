-- Stage 51 migration: run in the Supabase SQL editor after schema_stage50.
--
-- Phase 2, step 2 of 6 — Due dates. Purely additive, same pattern as
-- estimated_delivery_date (Stage 18): a nullable date column with no
-- default, so every existing invoice (and every new one where nobody
-- sets it) behaves exactly as before. Used for the overdue indicator on
-- the dashboard now, and will be what the payment-reminders fix and
-- recurring invoices both key off later — building it now, on its own,
-- keeps those two changes smaller when their turn comes.
alter table invoices add column if not exists due_date date;
