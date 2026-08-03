-- Stage 22 migration: run in the Supabase SQL editor after schema_stage21
-- (or whatever your latest applied stage is).
--
-- Supports the three AI features in this stage: AI Invoice Assistant,
-- AI Business Insights, AI Expense Categorization (see README_STAGE22.md).
-- Two small additions, no new tables.

-- Business Insights are cached rather than regenerated on every page
-- load (see app/api/ai/insights/route.js) — every generation costs a
-- real Claude API call, and a business's numbers don't change
-- meaningfully minute to minute. jsonb rather than a separate table:
-- this is always exactly "the current set of insights for this
-- business," never a history that needs its own rows.
alter table businesses add column if not exists ai_insights jsonb;
alter table businesses add column if not exists ai_insights_generated_at timestamptz;

-- AI Expense Categorization extracts a vendor name off a photographed
-- receipt (see app/api/ai/extract-receipt/route.js) — expenses had no
-- field to put that in before this stage; description was free text for
-- a note, not structured enough to reliably show "vendor" on its own.
alter table expenses add column if not exists vendor text;
