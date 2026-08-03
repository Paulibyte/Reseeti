-- Stage 11 migration: run in the Supabase SQL editor after schema_stage10.sql
--
-- Professional invoice numbering: replaces the old client-generated
-- 'INV-' + timestamp scheme (not sequential, and not collision-safe now
-- that Stage 8 lets multiple staff on multiple devices invoice for the
-- same business at once) with a real per-business sequence formatted as
-- PREFIX-YEAR-000001, e.g. RST-2026-000001 or ABJ-2026-001045.
--
-- Numbering is assigned by the DATABASE, not the client, via a BEFORE
-- INSERT trigger. This is the only way to guarantee both "sequential, no
-- gaps from cancelled drafts" and "no two invoices ever get the same
-- number," even when two staff members sync offline invoices from
-- different devices at the same moment.

-- ---------- 1. Business-chosen prefix ----------
-- Short, uppercase, alphanumeric — e.g. a business's initials or city
-- code. Defaults to 'INV' so every existing business keeps working
-- without needing to set anything.
alter table businesses add column if not exists invoice_prefix text not null default 'INV';

alter table businesses add constraint invoice_prefix_format
  check (invoice_prefix ~ '^[A-Z0-9]{2,6}$');

-- ---------- 2. Per-business, per-year counter ----------
-- One row per (business, year). last_number is the count of invoices
-- issued so far that year — incremented atomically on every insert (see
-- the trigger below), which is what makes this safe under concurrent
-- writes from multiple devices.
create table if not exists invoice_counters (
  business_id uuid references businesses(id) on delete cascade not null,
  year int not null,
  last_number int not null default 0,
  primary key (business_id, year)
);

alter table invoice_counters enable row level security;

-- Read-only for members, for transparency (e.g. a settings page could
-- show "next number: 001046"). No insert/update/delete policy is defined
-- on purpose — the only writes come from the SECURITY DEFINER trigger
-- function below, which bypasses RLS internally. Direct client writes to
-- this table are never allowed, since that's exactly what would let the
-- guarantee below be defeated.
create policy "Members can view their invoice counter"
  on invoice_counters for select
  using (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));

-- ---------- 3. The number-assigning trigger ----------
-- Runs BEFORE INSERT, so it can overwrite NEW.invoice_number before the
-- NOT NULL constraint on invoices.invoice_number is checked — meaning the
-- client doesn't need to (and should stop trying to) supply this value at
-- all. Whatever the client sends is discarded; the server always has the
-- final say, which is what closes off both duplicate numbers and a staff
-- member spoofing a number out of sequence.
create or replace function public.assign_invoice_number()
returns trigger as $$
declare
  v_year int := extract(year from coalesce(new.created_at, now()));
  v_prefix text;
  v_number int;
begin
  select invoice_prefix into v_prefix from businesses where id = new.business_id;
  v_prefix := coalesce(v_prefix, 'INV');

  insert into invoice_counters (business_id, year, last_number)
  values (new.business_id, v_year, 1)
  on conflict (business_id, year)
  do update set last_number = invoice_counters.last_number + 1
  returning last_number into v_number;

  new.invoice_number := v_prefix || '-' || v_year || '-' || lpad(v_number::text, 6, '0');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_invoice_number_assign on invoices;
create trigger on_invoice_number_assign
  before insert on invoices
  for each row execute procedure public.assign_invoice_number();

-- Note: existing invoices are untouched — their old 'INV-123456' style
-- numbers stay exactly as they are. This only governs numbers assigned to
-- invoices created from this point forward. Mixed formats in your invoice
-- list are expected and fine; nothing reads structure out of the number.
