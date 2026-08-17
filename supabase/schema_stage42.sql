-- Stage 42 migration: CRITICAL — the real root cause of every signup
-- failure today. Run in the Supabase SQL editor after schema_stage41.
--
-- Postgres logs showed the actual underlying error behind "Database
-- error saving new user": 42P01, relation "business_members" does not
-- exist. Both handle_new_user() (schema_stage8.sql, creates a business
-- + owner membership on signup) and prevent_role_escalation()
-- (schema_stage18.sql, fires on every business_members insert/update —
-- including the one handle_new_user() itself makes) are SECURITY
-- DEFINER functions that never set an explicit search_path. A
-- SECURITY DEFINER function's privileges come from its owner, but its
-- search_path is inherited from the CALLING session unless set
-- explicitly — and the caller here is Supabase's internal
-- supabase_auth_admin role (visible in the log's "User" field), whose
-- own default search_path apparently doesn't include `public`, where
-- these tables actually live. Unqualified table names inside the
-- function then fail to resolve at all.
--
-- Today's other two SECURITY DEFINER helpers
-- (my_active_business_ids/my_active_manager_business_ids) already set
-- this correctly, which is exactly why they never showed this failure
-- — these two are the only ones that didn't, and are genuinely the
-- last piece of the whole signup problem.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  pending record;
  new_business_id uuid;
begin
  select * into pending
  from business_members
  where phone = new.phone and status = 'invited' and user_id is null
  limit 1;

  if found then
    update business_members
    set user_id = new.id, status = 'active', joined_at = now()
    where id = pending.id;
  else
    insert into businesses (user_id, name, phone)
    values (new.id, 'My Business', new.phone)
    returning id into new_business_id;

    insert into business_members (business_id, user_id, phone, role, status, joined_at)
    values (new_business_id, new.id, new.phone, 'owner', 'active', now());
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

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
    return new;
  end if;

  if new.role in ('owner', 'manager') then
    raise exception 'Only the business owner can assign the % role', new.role;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;
