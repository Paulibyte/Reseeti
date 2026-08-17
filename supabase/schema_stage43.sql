-- Stage 43 migration: run in the Supabase SQL editor after schema_stage42.
--
-- Part 1: fixes a real bug found while building multi-business support —
-- team/page.js's invite form stored phone numbers WITH a leading '+'
-- (e.g. "+2348068744434"), but Supabase's own auth.users.phone is
-- stored WITHOUT one ("2348068744434"). handle_new_user()'s matching
-- (`where phone = new.phone`) can only ever succeed if both sides use
-- the same format — meaning staff invites have likely never actually
-- auto-linked on signup, even for a genuinely brand-new phone number,
-- this whole time. Normalizes every existing business_members.phone
-- value to match; app/dashboard/team/page.js is updated alongside this
-- to store new invites correctly going forward (see lib/phone.js).
update business_members set phone = ltrim(phone, '+') where phone like '+%';

-- Part 2: multi-business support. business_members already allows a
-- user_id to hold multiple active rows (no unique constraint beyond
-- (business_id, phone)) — the only real blocker was application code
-- assuming exactly one via .single(), fixed in lib/getMyBusiness.js and
-- lib/supabaseServer.js. This index just makes "does this phone have any
-- pending invites" (the new /api/invites/pending route) fast, since
-- that's now a real, regularly-run query rather than a one-off signup
-- check.
create index if not exists idx_business_members_phone_invited
  on business_members(phone) where status = 'invited' and user_id is null;
