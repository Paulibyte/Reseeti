-- Stage 8 fix: resolves 42P17 "infinite recursion detected in policy for
-- relation business_members" introduced by schema_stage8.sql.
--
-- Root cause: the "Members can view their team" SELECT policy on
-- business_members queried business_members itself (aliased bm2) inside
-- its own USING clause. Postgres re-applies the same policy to that
-- inner query, which re-triggers the policy again, forever.
--
-- Fix: move the "which businesses is this user an active member of"
-- lookup into a SECURITY DEFINER function. That function runs with
-- elevated privileges, so its internal query bypasses RLS and doesn't
-- re-trigger the policy that's calling it.
--
-- Run this in the Supabase SQL editor after schema_stage8.sql.

-- ---------- 1. Helper function ----------
-- Only ever returns business_ids for auth.uid() (the calling user), so
-- it can't be used to enumerate other users' memberships even though it
-- runs with elevated privileges.
create or replace function my_active_business_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select business_id from business_members
  where user_id = auth.uid() and status = 'active'
$$;

-- Lock down who can call it directly (defense in depth — the
-- auth.uid() filter above already limits what it returns).
revoke execute on function my_active_business_ids from public;
grant execute on function my_active_business_ids to authenticated;

-- ---------- 2. Replace the recursive policy ----------
drop policy if exists "Members can view their team" on business_members;

create policy "Members can view their team"
  on business_members for select
  using (business_id in (select my_active_business_ids()));

-- ---------- 3. Note ----------
-- No other stage 8 policy needed this fix: "Members manage
-- invoices/invoice_items/customers/products" reference business_members
-- from a *different* table's policy, which doesn't recurse. "Owner
-- manages team invites/updates/removes" check against businesses, not
-- business_members, so those are unaffected too. Only the one SELECT
-- policy on business_members referenced its own table.
