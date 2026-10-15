-- Stage 59 migration: run in the Supabase SQL editor after schema_stage58.
--
-- Invoice voiding, plus the minimum payment-refund path voiding needs.
--
-- WHY THIS EXISTS
-- Until now the only way to get rid of a wrong invoice was a hard delete
-- (app/dashboard/page.js, deleteInvoiceRow), which removes the record
-- entirely AND leaves the stock it deducted permanently gone — there is
-- no delete-side trigger restoring it. A void is the accountable
-- alternative: the invoice stays in history, clearly marked VOID, with
-- who voided it, when, and why; stock is returned; any serialized unit
-- on it becomes sellable again.
--
-- RULES (set by the business owner)
--   * Only the owner or a manager can void (honouring Stage 28 per-member
--     overrides via the new "voidInvoice" permission key — see
--     lib/permissions.js).
--   * An invoice with payments recorded CANNOT be voided. The payments
--     must be refunded first. Cloud had no refund mechanism at all
--     (invoice_payments rejects negative amounts, nothing reversed a
--     payment), so refund_invoice_payment() below is the minimum needed
--     to make that rule workable rather than a dead end.
--
-- DESIGN NOTES
--   * Both actions are SECURITY DEFINER functions that check the caller's
--     role themselves. Stage 28 documents that most permission flags are
--     enforced only in the app; for money and stock that isn't enough,
--     because invoices are updatable by any active member through RLS.
--   * A guard trigger stops those direct updates from setting or changing
--     the void columns, so a cashier can't void (or un-void) an invoice
--     with a raw API call that skips the function.
--   * Device-unit "sold" status is DERIVED from invoice_items in this app
--     (no flag on the unit), so voiding does NOT touch invoice_items —
--     the unit<->invoice record stays intact for the Serial/IMEI lookup.
--     The three places that derive "sold" now ignore voided invoices
--     (app code, same stage).
--   * Refunded payments are ARCHIVED into invoice_payment_refunds and then
--     removed from invoice_payments, rather than adding negative rows.
--     Every existing report that sums invoice_payments stays correct with
--     no changes; the full history lives in the archive table.
--
-- Every statement is safe to run more than once.

-- ---------- 1. Void columns on invoices ----------
alter table invoices
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists void_notes text,
  add column if not exists voided_by uuid references auth.users(id) on delete set null;

create index if not exists idx_invoices_voided
  on invoices(business_id, voided_at)
  where voided_at is not null;

-- ---------- 2. Allow 'void' as a stock-movement reason ----------
-- The original column CHECK was created inline, so its name is
-- auto-generated and may differ if the table was ever touched by hand.
-- Find whatever CHECK currently constrains "reason" and replace it.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.stock_movements'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reason%'
  loop
    execute format('alter table public.stock_movements drop constraint %I', c.conname);
  end loop;

  alter table public.stock_movements
    add constraint stock_movements_reason_check
    check (reason in ('sale', 'restock', 'adjustment', 'correction', 'void'));
end $$;

-- ---------- 3. Refund archive ----------
create table if not exists invoice_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  original_payment_id uuid,
  amount numeric(12,2) not null,
  method text,
  original_paid_at timestamptz,
  refund_reason text not null,
  refunded_by uuid references auth.users(id) on delete set null,
  refunded_at timestamptz not null default now()
);

create index if not exists idx_payment_refunds_invoice on invoice_payment_refunds(invoice_id);
create index if not exists idx_payment_refunds_business on invoice_payment_refunds(business_id, refunded_at desc);

alter table invoice_payment_refunds enable row level security;

-- Read-only to members. There is deliberately NO insert/update/delete
-- policy: rows can only be created by refund_invoice_payment() (which
-- runs as its owner and so isn't subject to RLS), and can never be
-- edited or removed through the API afterwards.
drop policy if exists "Members read payment refunds" on invoice_payment_refunds;
create policy "Members read payment refunds"
  on invoice_payment_refunds for select
  using (business_id in (
    select business_id from business_members
    where user_id = auth.uid() and status = 'active'
  ));

-- ---------- 4. Role check, mirroring lib/permissions.js can() ----------
-- Owner: always. Everyone else: an explicit per-member override wins if
-- present; otherwise the role default (manager = yes, others = no).
-- Self-contained on purpose — it does not depend on
-- my_active_manager_business_ids(), which Stage 41 references but no
-- migration in the repo defines.
create or replace function public.can_void_invoices(p_business_id uuid)
returns boolean as $$
declare
  v_owner uuid;
  v_role text;
  v_overrides jsonb;
begin
  select user_id into v_owner from businesses where id = p_business_id;
  if v_owner is not null and v_owner = auth.uid() then
    return true;
  end if;

  select role, permission_overrides
  into v_role, v_overrides
  from business_members
  where business_id = p_business_id
    and user_id = auth.uid()
    and status = 'active';

  if v_role is null then
    return false;
  end if;
  if v_role = 'owner' then
    return true;
  end if;

  return coalesce((v_overrides ->> 'voidInvoice')::boolean, v_role = 'manager');
end;
$$ language plpgsql security definer stable;

-- ---------- 5. Guard: void columns only change through the functions ----------
create or replace function public.guard_invoice_void_columns()
returns trigger as $$
declare
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_changed := new.voided_at is not null
              or new.void_reason is not null
              or new.void_notes is not null
              or new.voided_by is not null;
  else
    v_changed := new.voided_at is distinct from old.voided_at
              or new.void_reason is distinct from old.void_reason
              or new.void_notes is distinct from old.void_notes
              or new.voided_by is distinct from old.voided_by;
  end if;

  if v_changed and coalesce(current_setting('app.void_in_progress', true), '') <> 'on' then
    raise exception 'Invoices can only be voided through the void function.'
      using errcode = '42501';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_guard_invoice_void_columns on invoices;
create trigger trg_guard_invoice_void_columns
  before insert or update on invoices
  for each row execute function public.guard_invoice_void_columns();

-- ---------- 6. void_invoice ----------
create or replace function public.void_invoice(
  p_invoice_id uuid,
  p_reason text,
  p_notes text default null
)
returns jsonb as $$
declare
  v_inv invoices%rowtype;
  v_paid numeric(12,2);
  v_item record;
  v_type text;
  v_new_stock numeric(12,2);
  v_restocked int := 0;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Choose a reason for voiding this invoice.' using errcode = 'P0001';
  end if;

  -- Lock the row so two people voiding at the same moment can't both
  -- pass the checks below and double-restore the stock.
  select * into v_inv from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0002';
  end if;

  if not public.can_void_invoices(v_inv.business_id) then
    raise exception 'Only the owner or a manager can void invoices.' using errcode = '42501';
  end if;

  if v_inv.voided_at is not null then
    raise exception 'This invoice has already been voided.' using errcode = 'P0001';
  end if;

  -- The real ledger is invoice_payments. The "paid" flag alone isn't
  -- enough to go on: the existing "mark as unpaid" action clears the
  -- flag but deliberately leaves the payment rows, so an invoice can be
  -- unpaid yet still hold recorded money.
  select coalesce(sum(amount), 0) into v_paid from invoice_payments where invoice_id = p_invoice_id;
  if v_paid > 0 then
    raise exception 'This invoice has NGN % in payments recorded. Refund them before voiding it.',
      to_char(v_paid, 'FM999,999,999,990.00')
      using errcode = 'P0001';
  end if;
  -- Legacy invoices (before invoice_payments existed) can be flagged
  -- paid with no payment rows at all; nothing to refund there, so the
  -- existing "mark as unpaid" action is the way out.
  if v_inv.paid then
    raise exception 'This invoice is marked as paid. Mark it as unpaid first, then void it.'
      using errcode = 'P0001';
  end if;

  -- Reverse deduct_stock_on_sale() (Stage 49) exactly: every non-service
  -- product on the invoice, serialized ones included, gets its quantity
  -- back, with a stock_movements row so "why is my stock X" stays
  -- answerable. A product deleted since the sale (product_id is null or
  -- the row is gone) is skipped, same as the sale trigger would have.
  for v_item in
    select product_id, qty
    from invoice_items
    where invoice_id = p_invoice_id and product_id is not null
  loop
    select type into v_type from products where id = v_item.product_id;
    if v_type is null or v_type = 'service' then
      continue;
    end if;

    update products
    set stock_qty = stock_qty + v_item.qty,
        updated_at = now()
    where id = v_item.product_id
    returning stock_qty into v_new_stock;

    insert into stock_movements
      (business_id, product_id, change_qty, reason, invoice_id, performed_by, note, resulting_stock_qty)
    values
      (v_inv.business_id, v_item.product_id, v_item.qty, 'void', p_invoice_id, auth.uid(),
       'Invoice ' || v_inv.invoice_number || ' voided: ' || p_reason, v_new_stock);

    v_restocked := v_restocked + 1;
  end loop;

  perform set_config('app.void_in_progress', 'on', true);
  update invoices
  set voided_at = now(),
      void_reason = btrim(p_reason),
      void_notes = nullif(btrim(coalesce(p_notes, '')), ''),
      voided_by = auth.uid()
  where id = p_invoice_id;
  perform set_config('app.void_in_progress', 'off', true);

  -- Surfaces on the owner's Activity & Audit page (app/api/activity).
  insert into events (business_id, user_id, event_type, metadata)
  values (
    v_inv.business_id, auth.uid(), 'invoice_voided',
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'invoice_number', v_inv.invoice_number,
      'customer_name', v_inv.customer_name,
      'amount', v_inv.total,
      'reason', btrim(p_reason),
      'notes', nullif(btrim(coalesce(p_notes, '')), ''),
      'summary', 'Voided ' || v_inv.invoice_number || ' — ' || btrim(p_reason)
    )
  );

  return jsonb_build_object('voided', true, 'products_restocked', v_restocked);
end;
$$ language plpgsql security definer;

-- ---------- 7. refund_invoice_payment ----------
-- Reverses ONE recorded payment. Same authority as voiding (owner or a
-- manager / the voidInvoice permission) — returning a customer's money
-- is at least as sensitive as voiding the sale. Allowed on a voided
-- invoice too, so money that arrives late (e.g. an online-payment
-- webhook landing after the void) can still be returned and recorded.
create or replace function public.refund_invoice_payment(
  p_payment_id uuid,
  p_reason text
)
returns jsonb as $$
declare
  v_pay invoice_payments%rowtype;
  v_inv invoices%rowtype;
  v_remaining numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Enter a reason for this refund.' using errcode = 'P0001';
  end if;

  select * into v_pay from invoice_payments where id = p_payment_id;
  if not found then
    raise exception 'That payment was not found — it may already have been refunded.' using errcode = 'P0002';
  end if;

  select * into v_inv from invoices where id = v_pay.invoice_id for update;

  if not public.can_void_invoices(v_inv.business_id) then
    raise exception 'Only the owner or a manager can refund payments.' using errcode = '42501';
  end if;

  -- Re-read under the invoice lock: another refund may have just won.
  select * into v_pay from invoice_payments where id = p_payment_id;
  if not found then
    raise exception 'That payment was not found — it may already have been refunded.' using errcode = 'P0002';
  end if;

  insert into invoice_payment_refunds
    (business_id, invoice_id, original_payment_id, amount, method, original_paid_at, refund_reason, refunded_by)
  values
    (v_inv.business_id, v_inv.id, v_pay.id, v_pay.amount, v_pay.method, v_pay.created_at, btrim(p_reason), auth.uid());

  delete from invoice_payments where id = p_payment_id;

  select coalesce(sum(amount), 0) into v_remaining from invoice_payments where invoice_id = v_inv.id;

  -- Same reset the existing "mark as unpaid" action performs.
  if v_inv.paid and v_remaining < v_inv.total then
    update invoices set paid = false, paid_at = null where id = v_inv.id;
  end if;

  insert into events (business_id, user_id, event_type, metadata)
  values (
    v_inv.business_id, auth.uid(), 'invoice_payment_refunded',
    jsonb_build_object(
      'invoice_id', v_inv.id,
      'invoice_number', v_inv.invoice_number,
      'amount', v_pay.amount,
      'method', v_pay.method,
      'reason', btrim(p_reason),
      'summary', 'Refunded NGN ' || to_char(v_pay.amount, 'FM999,999,999,990.00')
                 || ' (' || v_pay.method || ') on ' || v_inv.invoice_number || ' — ' || btrim(p_reason)
    )
  );

  return jsonb_build_object('refunded', true, 'remaining_paid', v_remaining);
end;
$$ language plpgsql security definer;

-- The client calls these through supabase.rpc(); signed-in users only
-- (each function re-checks the caller's actual role itself).
revoke all on function public.void_invoice(uuid, text, text) from public;
revoke all on function public.refund_invoice_payment(uuid, text) from public;
revoke all on function public.can_void_invoices(uuid) from public;
grant execute on function public.void_invoice(uuid, text, text) to authenticated;
grant execute on function public.refund_invoice_payment(uuid, text) to authenticated;
grant execute on function public.can_void_invoices(uuid) to authenticated;

insert into schema_migrations (version, name) values (59, 'schema_stage59')
on conflict (version) do nothing;
