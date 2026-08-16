-- Stage 40 migration: CRITICAL — run this immediately, before any more
-- new users try to sign up. Run in the Supabase SQL editor after
-- schema_stage39.
--
-- Bug: prevent_role_escalation() (schema_stage18.sql) checks whether
-- the caller inserting/updating a business_members row is already an
-- 'owner' of that business, via auth.uid(). But the very FIRST
-- membership row ever created for a business — a brand-new person's
-- first signup, via handle_new_user()'s trigger on auth.users
-- (schema_stage8.sql) — happens inside Supabase's own internal
-- account-creation process, which has no authenticated session/
-- auth.uid() context at all. The trigger saw "nobody is owner yet" and
-- refused to let that first row assign itself role='owner', raising an
-- exception that surfaced one layer up as Auth's generic "Database
-- error saving new user" — meaning every genuinely new phone number
-- has been unable to create an account since Stage 18 shipped.
--
-- Fix: a business's very first membership row is exempt from this
-- check entirely — there's no existing owner's privilege to escalate
-- past yet, so the scenario this trigger exists to prevent literally
-- cannot apply to it. Safe to exempt broadly (not just from inside
-- handle_new_user()) because the only way to reach an INSERT on
-- business_members for a business with zero existing members at all is
-- either this same trusted signup trigger, or a manual admin action —
-- the app's own RLS insert policy on business_members already requires
-- the caller to already own or manage the target business_id, which by
-- definition can't be true yet for a business with no members.
create or replace function public.prevent_role_escalation()
returns trigger as $$
declare
  v_caller_role text;
  v_existing_members int;
begin
  select count(*) into v_existing_members from business_members where business_id = new.business_id;
  if v_existing_members = 0 then
    return new;
  end if;

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
