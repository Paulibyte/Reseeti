-- Read-only — finds likely duplicate invoices to review manually before
-- deleting anything. "Likely duplicate" here means: same business, same
-- customer, same total, created within 2 minutes of each other — the
-- signature of a retried sync (see schema_stage32.sql's comment for why
-- this happened). Not a certainty — a customer genuinely buying the same
-- total twice in a row would also match — so review each group's
-- invoice_items before deleting either row.
select
  a.id as invoice_a_id,
  a.invoice_number as invoice_a_number,
  b.id as invoice_b_id,
  b.invoice_number as invoice_b_number,
  a.customer_name,
  a.total,
  a.created_at as created_a,
  b.created_at as created_b
from invoices a
join invoices b
  on a.business_id = b.business_id
  and a.id < b.id
  and a.customer_name is not distinct from b.customer_name
  and a.total = b.total
  and abs(extract(epoch from (a.created_at - b.created_at))) < 120
order by a.created_at desc;
