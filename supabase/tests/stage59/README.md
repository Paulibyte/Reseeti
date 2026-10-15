# Stage 59 database tests

Runs `schema_stage59.sql` against a real Postgres engine (PGlite — Postgres
compiled to WASM, no server or Docker needed) with minimal stand-ins for the
existing tables and Supabase's `auth.uid()`, then exercises void / refund
rules: role checks, per-member overrides, the forged-void guard, the
payments block, stock restoration, audit events, idempotent re-runs.

```
cd supabase/tests/stage59
npm init -y && npm install @electric-sql/pglite
node test.mjs
```

The stand-in tables in `setup.sql` are shaped from the real migrations
(schema.sql, stage 8, 15b, 28, 30, 49). If a later migration changes those
tables, update `setup.sql` to match. This is a logic test, not a substitute
for running the migration against a staging copy of the real database.
