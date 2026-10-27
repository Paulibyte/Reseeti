-- Stage 60 migration: run in the Supabase SQL editor after schema_stage59.
--
-- "List on Jobtins": an opt-in switch, per business.
--
-- Jobtins (a separate shopping site) shows products from the public
-- catalogues of Reseeti businesses. A catalogue being public is not the
-- same as the owner agreeing to appear in a third-party marketplace, so
-- nothing is listed until the OWNER switches this on from the Catalogue
-- page. Everyone starts switched OFF — including every existing business.
--
-- The public catalogue feed (app/api/catalogue/public/[slug]) refuses to
-- serve a business unless this is true, so switching it off removes the
-- business from Jobtins at Jobtins' next sync.
--
-- jobtins_opt_in_at records WHEN the owner agreed (cleared on opt-out; the
-- Activity page keeps the history of both events).
--
-- Only the owner can change this: the "Owner can update their business"
-- policy (Stage 8) already restricts updates to businesses to the owner,
-- and the route that the page uses re-checks it.
--
-- Safe to run more than once.

alter table businesses add column if not exists jobtins_opt_in boolean not null default false;
alter table businesses add column if not exists jobtins_opt_in_at timestamptz;

insert into schema_migrations (version, name) values (60, 'schema_stage60')
on conflict (version) do nothing;
