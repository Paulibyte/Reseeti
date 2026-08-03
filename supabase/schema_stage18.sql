-- Stage 18 migration: run in the Supabase SQL editor after schema_stage17
-- (or whatever your latest applied stage is).
--
-- Expands business_members.role from the binary owner/staff (Stage 8)
-- into five roles — Owner, Manager, Cashier, Salesperson, Accountant —
-- matching the permission matrix in lib/permissions.js.
--
-- IMPORTANT — read before running: most of the 12 permissions in that
-- matrix (manageCustomers, manageInventory, manageExpenses,
-- manageCashbook, viewAnalytics, viewReports) are enforced at the
-- APPLICATION layer (which pages/buttons render for which role), not
-- rewritten here as new RLS policies. That's a deliberate scope decision,
-- not an oversight — see README_STAGE18.md's "Why not full RLS per
-- permission" section for the reasoning. This migration DOES add real
-- database-level enforcement for the two actions where a UI-only
-- restriction would be a genuine security gap: deleting an invoice
-- (destructive, and there was no delete capability — nor any RLS policy
-- restricting one — before this stage), and managing team membership
-- (a trust-level action; Stage 8 already made this owner-only at the DB
-- layer, this stage extends it to include Manager per the matrix).

-- ---------- 1. Expand the role column ----------
alter table business_members drop constraint if exists business_members_role_check;
alter table business_members add constraint business_members_role_check
  check (role in ('owner', 'manager', 'cashier', 'salesperson', 'accountant'));

-- The column's old default ('staff') is no longer a valid value under the
-- constraint above — every insert in the app now sets role explicitly
-- (team/page.js's invite form, and the owner-signup trigger from Stage 8),
-- but fixing the default too means a future insert that forgets to set it
-- fails safely with a clear constraint error instead of silently trying
-- to write an invalid value.
alter table business_members alter column role set default 'cashier';

-- Existing 'staff' rows: under Stage 8's original model, staff had full
-- day-to-day operational access (invoices, customers, products, expenses,
-- cashbook). 'manager' is the closest match in the new model and the
-- only safe default — anything narrower would silently take away access
-- someone already had.
update business_members set role = 'manager' where role = 'staff';

-- ---------- 2. Prevent privilege escalation by a Manager ----------
-- Managers can invite/remove/reassign team members (see the RLS changes
-- below), but only the literal Owner should ever be able to create
-- another Manager or hand out the Owner role — otherwise "Manager" would
-- be an accidental route to Owner-equivalent power. This is a trigger,
-- not just a client-side restriction in team/page.js, so it holds even
-- against a direct API call.
create or replace function public.prevent_role_escalation()
returns trigger as $$
declare
  v_caller_role text;
begin
  select role into v_caller_role from business_members
  where business_id = new.business_id and user_id = auth.uid() and status = 'active';

  if v_caller_role = 'owner' then
    return new; -- Owner can assign any role.
  end if;

  if new.role in ('owner', 'manager') then
    raise exception 'Only the business owner can assign the % role', new.role;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_business_members_role_escalation on business_members;
create trigger on_business_members_role_escalation
  before insert or update of role on business_members
  for each row execute procedure public.prevent_role_escalation();

-- ---------- 3. Team management: extend Owner-only to Owner + Manager ----------
drop policy if exists "Owner manages team invites" on business_members;
drop policy if exists "Owner updates team members" on business_members;
drop policy if exists "Owner removes team members" on business_members;

create policy "Owner or manager manages team invites"
  on business_members for insert
  with check (
    business_id in (select id from businesses where user_id = auth.uid())
    or business_id in (
      select business_id from business_members
      where user_id = auth.uid() and status = 'active' and role = 'manager'
    )
  );

create policy "Owner or manager updates team members"
  on business_members for update
  using (
    business_id in (select id from businesses where user_id = auth.uid())
    or business_id in (
      select business_id from business_members
      where user_id = auth.uid() and status = 'active' and role = 'manager'
    )
  );

create policy "Owner or manager removes team members"
  on business_members for delete
  using (
    business_id in (select id from businesses where user_id = auth.uid())
    or business_id in (
      select business_id from business_members
      where user_id = auth.uid() and status = 'active' and role = 'manager'
    )
  );

-- ---------- 4. Invoice deletion: new capability, Owner + Manager only ----------
-- Stage 8's "Members manage invoices" policy was `for all`, which
-- technically already permitted deletion by any active member — there
-- just wasn't a UI button for it. Splitting it into separate policies
-- closes that latent gap at the same time as adding the real feature.
drop policy if exists "Members manage invoices" on invoices;

create policy "Members view invoices"
  on invoices for select
  using (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));

create policy "Members create invoices"
  on invoices for insert
  with check (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));

create policy "Members update invoices"
  on invoices for update
  using (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'))
  with check (business_id in (select business_id from business_members where user_id = auth.uid() and status = 'active'));

create policy "Owner or manager deletes invoices"
  on invoices for delete
  using (
    business_id in (select id from businesses where user_id = auth.uid())
    or business_id in (
      select business_id from business_members
      where user_id = auth.uid() and status = 'active' and role = 'manager'
    )
  );

-- Note: invoice_items and invoice_payments cascade-delete (on delete
-- cascade, set up in Stage 8 and Stage 15 respectively) when their parent
-- invoice is deleted, so no separate policy change is needed there.
