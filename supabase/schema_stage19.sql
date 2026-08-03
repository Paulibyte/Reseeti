-- Stage 19 migration: run in the Supabase SQL editor after schema_stage18
-- (or whatever your latest applied stage is).
--
-- This stage's real work is client-side (pagination, infinite scroll,
-- virtualization, caching, code splitting, background sync — see
-- README_STAGE19.md), but two of those depend on the database being able
-- to serve "give me page N ordered by name" cheaply.
--
-- invoices already had idx_invoices_business_created (business_id,
-- created_at) since Stage 1, which is exactly what the invoice list's
-- .range() pagination (ordered by created_at) needs — no change required
-- there. customers and products, however, only had a plain business_id
-- index (Stage 6): fine for "give me everything," but ordering that by
-- name for the customers/inventory pages' pagination still means a sort
-- step over every row. These composite indexes let Postgres satisfy
-- "WHERE business_id = ? ORDER BY name" directly from the index instead.

create index if not exists idx_customers_business_name on customers(business_id, name);
create index if not exists idx_products_business_name on products(business_id, name);
