# Database migrations & versioning

Reseeti's database has been evolving one file per stage since Stage 1
(`schema.sql`, then `schema_stage2.sql` through the current stage). This
file documents that convention properly now that Stage 27 added actual
version tracking (`schema_migrations`) — it was an implicit convention
before; this is it written down, plus the one small process addition.

## The convention

- Every stage that needs a database change gets exactly one file:
  `supabase/schema_stageN.sql`, where N is that stage's number.
- Every statement in every migration is written to be **safe to run
  more than once** — `create table if not exists`, `add column if not
  exists`, `create index if not exists`, `create or replace function`,
  `drop policy if exists ... ; create policy ...`. This matters because
  there's no tracking of "has this exact file been run" beyond the
  version marker below (which is informational, not enforced) — running
  a migration twice by mistake should be a harmless no-op, not an error
  or a duplicate.
- Migrations are applied **manually**, in order, by pasting each file's
  contents into the Supabase SQL editor and running it. There is no
  migration *runner* — no `npm run migrate`, no automatic ordering. This
  is a deliberate choice, not a gap: a tool like that adds real
  complexity (tracking applied state, handling partial failures, a CLI
  to install and configure) that a single-database small-business app
  doesn't get much benefit from. If Reseeti ever needs multiple
  environments (staging + production) with automated deploys, that's the
  point where a real migration tool (e.g. Supabase's own CLI migrations)
  earns its cost — see "What's deliberately left out" in
  README_STAGE27.md.

## Version tracking (new in Stage 27)

`schema_migrations` records which stage-numbered migrations have been
applied to a given database — `version` (the stage number), `name`, and
`applied_at`. Every migration going forward ends with:

```sql
insert into schema_migrations (version, name) values (N, 'schema_stageN')
on conflict (version) do nothing;
```

This is purely a record, not a gate — nothing stops a migration from
running whether or not a prior version's row exists. Its value is
answering "which migrations has this specific database actually had
applied" reliably, rather than guessing from which tables/columns happen
to exist. The Diagnostics page (`/dashboard/diagnostics`, Stage 21) now
shows the latest applied version it can see, which is a fast way to
notice a deployment that's running app code ahead of its database (a new
stage's code deployed before that stage's migration was run against
that environment's database).

## Applying a new migration

1. Open the Supabase SQL editor for your project.
2. Paste the full contents of the new `schema_stageN.sql`.
3. Run it. If anything errors, read the error — the `if not exists` /
   `or replace` patterns mean a genuine error almost always means
   something about your database's current state doesn't match what the
   migration assumes (e.g. a column renamed by hand outside the normal
   migration history), not that the migration was already applied.
4. Check the Diagnostics page shows the new version number.

## Backfilling an out-of-date database

If you're setting up a fresh Supabase project for Reseeti today, you
still need to run every `schema_stageN.sql` file **in numeric order**,
starting from `schema.sql` — there is no single "latest schema" file
that captures everything by itself. Each stage's migration only contains
what changed *in that stage*; later stages routinely `alter table` a
table an earlier stage created.
