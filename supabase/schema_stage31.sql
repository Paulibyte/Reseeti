-- Stage 31 migration: run in the Supabase SQL editor after schema_stage30
-- (or whatever your latest applied stage is).
--
-- Customer reviewer feedback asked to see "how a debtor is making
-- payment, with dates and balance." Until now invoice_payments only
-- ever got written all at once, when an invoice was marked fully paid
-- (see confirmMarkPaid in dashboard/page.js) — there was no way to log
-- a partial payment against a still-outstanding invoice and watch the
-- balance shrink over time, which is exactly how credit repayment
-- actually happens for most Nigerian traders (customer pays what they
-- have today, the rest next week).
--
-- No new columns needed — "amount paid so far" and "balance" are always
-- just sum(invoice_payments.amount) and total − that sum for a given
-- invoice, computed on read (see customers/[id]/page.js). This
-- migration only adds the piece that was missing: an invoice
-- automatically flips to paid once its running payment total reaches
-- its total, regardless of whether that happened in one shot (the
-- existing "mark as paid" flow) or across several partial payments (the
-- new "Record payment" action on the customer page).
create or replace function public.settle_invoice_from_payments()
returns trigger as $$
declare
  v_total numeric(12,2);
  v_already_paid boolean;
  v_paid_sum numeric(12,2);
begin
  select total, paid into v_total, v_already_paid from invoices where id = new.invoice_id;

  -- Nothing to do if already marked paid — this is exactly what happens
  -- for the existing "mark as paid" flow, which updates invoices.paid
  -- directly BEFORE inserting into invoice_payments (see
  -- confirmMarkPaid), so by the time this trigger fires for that path
  -- v_already_paid is already true. This trigger is purely additive for
  -- the new partial-payment path; it changes nothing about how a normal
  -- full mark-as-paid behaves, and never overwrites an existing paid_at.
  if v_already_paid then
    return new;
  end if;

  select coalesce(sum(amount), 0) into v_paid_sum
  from invoice_payments where invoice_id = new.invoice_id;

  if v_paid_sum >= v_total then
    update invoices set paid = true, paid_at = now() where id = new.invoice_id;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_invoice_payment_settle on invoice_payments;
create trigger on_invoice_payment_settle
  after insert on invoice_payments
  for each row execute procedure public.settle_invoice_from_payments();
