-- Referral program: a business's own id doubles as its referral code —
-- no separate code/slug needed. Sharing reseeti.com/login?ref=<business_id>
-- is enough; app/login/page.js captures it and passes it through as auth
-- metadata on signup, and the trigger below records it at the exact
-- moment a new business is created.
create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_business_id uuid references businesses(id) not null,
  referred_business_id uuid references businesses(id) not null unique,
  status text not null default 'pending' check (status in ('pending', 'qualified')),
  created_at timestamptz not null default now(),
  qualified_at timestamptz
);

alter table referrals enable row level security;

-- How many one-time 20%-off-annual discounts this business has earned
-- (one per qualified referral) and not yet used at checkout. A single
-- counter rather than per-referral tracking — simpler, and behaves
-- correctly whether each one gets used right away or several
-- accumulate. Consumed in app/api/paystack/initialize (applying the
-- discount) and app/api/paystack/webhook (only actually decremented
-- once that discounted payment genuinely succeeds).
alter table businesses add column available_referral_discounts integer not null default 0;

-- Same trigger as before, with one addition: when a genuinely new
-- business is created (not someone accepting a team invite), check for
-- a referral code in the new user's auth metadata and record it.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  pending record;
  new_business_id uuid;
  referrer_id uuid;
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

    -- referred_by is whatever ?ref= value app/login/page.js captured
    -- from the URL, if any — untrusted input, so a malformed or garbage
    -- value must never be allowed to break account creation itself.
    -- The cast is wrapped so a bad UUID just results in no referral
    -- being recorded, not a failed signup.
    begin
      referrer_id := (new.raw_user_meta_data->>'referred_by')::uuid;
    exception when others then
      referrer_id := null;
    end;

    if referrer_id is not null and referrer_id != new_business_id then
      if exists (select 1 from businesses where id = referrer_id) then
        insert into referrals (referrer_business_id, referred_business_id)
        values (referrer_id, new_business_id);
      end if;
    end if;
  end if;
  return new;
end;
$function$;
