-- Stage 46 migration: run in the Supabase SQL editor after schema_stage45.
--
-- Catalogue "Pay Now" checkout, built specifically so Reseeti's own
-- Paystack account (already used for Pro subscription billing) never
-- holds or touches a business's actual sales revenue — a real
-- distinction, not a technicality: routing customer payments through
-- Reseeti's own account would make Reseeti a payment intermediary for
-- money that was never Reseeti's, a materially different (and much
-- heavier) regulatory position than collecting its own SaaS fee.
--
-- Uses Paystack's Subaccounts + Split Payments feature — built
-- specifically for marketplace/platform use cases like this one.
-- Settlement goes directly from Paystack to the business's own bank
-- account on Paystack's normal settlement cycle; it never lands in
-- Reseeti's main balance. bank_name/bank_account_name/
-- bank_account_number already existed (used for showing bank details
-- on an invoice) — bank_code is the one new piece needed, since
-- Paystack's Subaccount API requires it and a bank's code isn't
-- something a business would know off-hand, hence the new bank-picker
-- in Settings pulling the list from Paystack directly.
alter table businesses add column if not exists bank_code text;
alter table businesses add column if not exists paystack_subaccount_code text;

-- payment_status is deliberately separate from `status` (pending/
-- converted/dismissed, Stage 45) — one tracks whether this order has
-- been turned into an invoice yet, the other tracks whether money has
-- actually moved. A WhatsApp-only order (no online payment attempted)
-- simply stays 'unpaid' forever, same as before this stage existed.
alter table catalogue_orders add column if not exists payment_status text not null default 'unpaid'
  check (payment_status in ('unpaid', 'pending_payment', 'paid'));
alter table catalogue_orders add column if not exists paystack_reference text;
