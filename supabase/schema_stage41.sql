-- Stage 41 migration: CRITICAL — run immediately. Run in the Supabase
-- SQL editor after schema_stage40.
--
-- `select * from pg_policies where tablename = 'invoices'` returned
-- zero rows — meaning no policy currently grants access to this table
-- for any operation (select/insert/update/delete), for any role other
-- than the service-role client. Every genuine business user is
-- currently unable to create (and likely soon unable to even view)
-- their own invoices.
--
-- schema_stage18.sql intended to replace a single permissive
-- "Members manage invoices" (for all) policy with four more specific
-- ones (view/create/update for any active member, delete restricted to
-- owner/manager) — matching the pattern already found broken elsewhere
-- today (Stages 35-38), this either never fully applied, or RLS on
-- this table was toggled on at some point with nothing yet re-created
-- to replace what covered it before.
--
-- Written using the existing SECURITY DEFINER helper
-- (my_active_business_ids(), from schema_stage8_fix.sql) from the
-- start, rather than a raw self-referencing subquery, so this doesn't
-- need a second follow-up fix the way several of today's other
-- policies did.
drop policy if exists "Members manage invoices" on invoices;
drop policy if exists "Members view invoices" on invoices;
drop policy if exists "Members create invoices" on invoices;
drop policy if exists "Members update invoices" on invoices;
drop policy if exists "Owner or manager deletes invoices" on invoices;

create policy "Members view invoices"
  on invoices for select
  using (business_id in (select my_active_business_ids()));

create policy "Members create invoices"
  on invoices for insert
  with check (business_id in (select my_active_business_ids()));

create policy "Members update invoices"
  on invoices for update
  using (business_id in (select my_active_business_ids()));

create policy "Owner or manager deletes invoices"
  on invoices for delete
  using (
    business_id in (select id from businesses where user_id = auth.uid())
    or business_id in (select my_active_manager_business_ids())
  );

-- Belt-and-braces: confirms RLS is actually enabled on this table (it
-- must already be, given the 42501 error means policies were being
-- checked at all — but costs nothing to be explicit rather than assume).
alter table invoices enable row level security;
