-- Stage 62 migration: run in the Supabase SQL editor after schema_stage61.
--
-- "List on HomeEase Nigeria": a second, SEPARATE opt-in switch per business.
--
-- HomeEase Nigeria is another shopping site (like Jobtins) that shows products from the public
-- catalogues of Reseeti businesses. Agreeing to appear on one marketplace is NOT agreeing to appear
-- on another, so each marketplace has its own switch, and each starts OFF for every business,
-- including every existing one.
--
-- The public catalogue feed (app/api/catalogue/public/[slug]) answers a marketplace only for the
-- businesses whose owner switched ON THAT marketplace. Switching one off does not touch the other.
--
-- homeease_opt_in_at records WHEN the owner agreed (cleared on opt-out; the Activity page keeps the
-- history of both events).
--
-- Safe to run more than once.

alter table businesses add column if not exists homeease_opt_in boolean not null default false;
alter table businesses add column if not exists homeease_opt_in_at timestamptz;

insert into schema_migrations (version, name) values (62, 'schema_stage62')
on conflict (version) do nothing;
