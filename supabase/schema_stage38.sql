-- Stage 38 migration: run in the Supabase SQL editor after schema_stage37.
--
-- Same root pattern as Stages 35-37: schema_stage18.sql's constraint
-- update apparently never fully applied to this database either — the
-- original Stage 8 constraint (role in ('owner','staff')) rejecting
-- 'cashier'/'manager'/'salesperson'/'accountant' on invite is exactly
-- what "violates check constraint business_members_role_check" looks
-- like from that older, narrower constraint.
--
-- Written to not depend on guessing the constraint's exact current
-- name — schema_stage18.sql's `drop constraint if exists
-- business_members_role_check` silently does nothing if the live
-- constraint has a different auto-generated name, which is
-- plausible given the pattern already found in Stages 35-37. This
-- finds and drops whatever check constraint currently exists on the
-- role column, by content rather than by name, then adds the correct
-- one back.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'business_members'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table business_members drop constraint %I', r.conname);
  end loop;
end $$;

alter table business_members add constraint business_members_role_check
  check (role in ('owner', 'manager', 'cashier', 'salesperson', 'accountant'));

-- Same established pattern, different table: schema_stage18.sql also
-- replaced a single broad "Members manage invoices" policy (any active
-- member, including delete) with split policies restricting delete to
-- owner/manager only. If that drop silently failed the same way the
-- business_members ones did, the old permissive policy is still
-- combining via OR with the new restrictive one — meaning ANY staff
-- member can currently delete invoices regardless of the new policy's
-- intent. Closing that gap here too, by content rather than by name,
-- for the same reason as above.
do $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
    where tablename = 'invoices' and cmd = 'ALL' and policyname = 'Members manage invoices'
  loop
    execute format('drop policy %I on invoices', r.policyname);
  end loop;
end $$;
