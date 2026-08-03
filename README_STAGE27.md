# Reseeti — Stage 27: Production Readiness

Nine items, all aimed at the same theme: what a real, production
business tool needs beyond its features — monitoring, legal groundwork,
support, onboarding, portability, and confidence that it actually works.

## 1. Error monitoring (Sentry)

Full `@sentry/nextjs` setup: `sentry.client.config.js` (browser),
`sentry.server.config.js` (Node routes), `sentry.edge.config.js` (edge,
unused today but included for completeness), `instrumentation.js`
(Next.js's own hook that loads the right config per runtime and wires up
`onRequestError` for Server Component/Route Handler errors), and
`app/global-error.jsx` (a friendly fallback for the rare error that
escapes everything else). `next.config.js` is wrapped with
`withSentryConfig` for source-map upload at build time.

Two deliberate privacy choices, given this app handles real customer
names, phone numbers, and payment amounts:
- **`sendDefaultPii: false`** (server config) — request bodies aren't
  sent to Sentry by default. Stack traces and error messages still are.
- **Session Replay is off** — it would capture a reconstructable
  recording of what a user saw, which is a meaningfully bigger data
  footprint than error tracking needs.

Needs `npm install` (it's a new dependency) and a Sentry project's DSN —
see Setup below. Safe to deploy even before that's configured; the SDK
no-ops without a DSN rather than erroring.

## 2. Automated database backups

New: `app/api/admin/database-backup/route.js`, a daily cron
(`vercel.json`). **Distinct from Stage 24's cloud backups** — that
feature exports one business's own data to that business's own
connected Google Drive/Dropbox/OneDrive, opt-in, per business. This is
platform-wide: every business, every core table, one JSON file per day,
uploaded to a private Supabase Storage bucket you control, with 30-day
retention.

**Read this part carefully**: this is a logical (row-level JSON) export
via the same admin client every other cron in this app uses — not a
true binary `pg_dump` or WAL-level backup. It's a genuine safety net for
a bad migration, an accidental bulk delete, or a data-corrupting bug,
but it does **not** replace Supabase's own built-in automated backups
and point-in-time recovery, which work at the database engine level and
restore to any point in time, not just to whenever this cron last ran.
Turn on Supabase's own backups (Project Settings → Database → Backups)
as your primary safety net; treat this as a secondary, app-level one.

## 3. Privacy Policy and Terms of Service

New public pages (`/privacy`, `/terms`) with real, Reseeti-specific
content — actual sub-processors named (Supabase, Twilio, Resend,
Paystack/OPay/Monnify, WhatsApp/Meta, the AI provider, optional
cloud-storage connections, Sentry), actual features described (the
7-day grace period, AI features requiring review before saving, offline
sync). **Both carry a prominent disclaimer**: this is a genuinely
tailored starting template, not legal advice — have a lawyer review it
before relying on it. Linked from the login page footer and the Help
page.

## 4. In-app feedback and bug reporting

A small "Feedback" tab on the side of every dashboard page
(`FeedbackButton.jsx`) opens a modal: pick a category (bug/idea/other),
write a message, optionally include a screenshot of the current screen
(captured via `html2canvas`, already a dependency — no new library
needed). Submissions are stored in a new `feedback` table and emailed to
you via the already-configured Resend integration
(`FEEDBACK_NOTIFICATION_EMAIL`). A failed screenshot capture or
notification email doesn't block the feedback itself from being saved.

## 5. Help/FAQ section

New public page (`/help`), also reachable from the sidebar — grouped,
expandable questions covering what's actually in the app: getting
started, invoices & payments, offline mode, team & roles, AI features,
backups & data, and troubleshooting (printer/scanner browser support,
"someone else has my login").

## 6. Onboarding walkthrough

New `OnboardingChecklist.jsx` on the dashboard, owner-only. Deliberately
**infers progress from real data** rather than tracking each step
explicitly — "have you added a product" is answered by counting
products, not by a flag set the moment an Add Product button was first
clicked, so it can't drift out of sync with reality. Four steps (logo,
first product, first customer, first invoice); dismissible, and stops
rendering entirely once every step is done rather than sitting there
fully-checked forever.

## 7. Import/export of business data

- **Export**: new `/api/export` route, reusing the exact same payload
  Stage 24's cloud backups already build — the difference is this comes
  straight back as a file download, for a business that wants a copy
  right now without connecting a cloud account first. "⬇ Export data
  now" on the Backups page.
- **Import**: new `ImportModal.jsx`, shared by Inventory and Customers'
  new "⬆ Import" buttons — upload a CSV or Excel file (parsed with
  `xlsx`, already a dependency for report exports, so no new library
  needed there either), preview which rows are valid, and import in
  batches of 50. A downloadable template button shows the expected
  columns before you even start.

## 8. Database migration/versioning

Two things: `supabase/MIGRATIONS.md` writes down the migration
convention this project has followed since Stage 1 (one file per stage,
every statement safe to re-run, applied manually and in order — that
part isn't new, just now documented). What **is** new:
`schema_migrations`, a table every migration going forward records
itself into, and a Diagnostics page section
(`/dashboard/diagnostics`) showing the latest version your specific
database has actually had applied — a fast way to notice a deployment
running app code ahead of its database.

## 9. Comprehensive end-to-end testing

New Playwright suite (`e2e/`), two tiers:
- **`e2e/public/`** — no login needed, runs anywhere: login page loads,
  unauthenticated dashboard access redirects, legal/help pages render,
  manifest is valid.
- **`e2e/authenticated/`** — needs a real session. Reseeti has no
  password (phone + SMS code), which a test runner can't receive — so
  `e2e/auth.setup.js` uses Supabase Auth's own **test phone numbers**
  feature (configured in your Supabase dashboard) to log in through the
  actual UI with a fixed OTP code, rather than manufacturing a session
  and skipping the real flow. Covers dashboard load, sidebar navigation,
  opening the invoice/product/customer forms, and the Security page.

See `e2e/README.md` for full setup — it's genuinely a few steps
(install Playwright's browsers, configure a Supabase test phone number),
not zero-config, and this stage is honest about that rather than
pretending otherwise.

## Setup

### 1. Run the migration
`supabase/schema_stage27.sql` — adds `feedback`,
`businesses.onboarding_dismissed`, and `schema_migrations` (with a
backfill of every prior stage's version number).

### 2. Create two Storage buckets
Both **private**, in Supabase Storage:
- `platform-backups` (or whatever you set `DATABASE_BACKUP_BUCKET` to) —
  for the automated database backup cron.
- `feedback-screenshots` — for optional feedback screenshots.

### 3. Install the new dependencies
```bash
npm install
npx playwright install --with-deps
```

### 4. Configure environment variables
See `.env.local.example` for the full list — Sentry (DSN, org, project,
auth token), `FEEDBACK_NOTIFICATION_EMAIL`, and optionally
`DATABASE_BACKUP_BUCKET` if you didn't use the default name.

### Test it
1. **Sentry**: throw a test error somewhere (or trigger a real one) and
   confirm it shows up in your Sentry project within a minute or two.
2. **Database backup**: manually trigger `/api/admin/database-backup`
   with your `CRON_SECRET` and confirm a JSON file lands in the
   `platform-backups` bucket.
3. **Legal pages**: visit `/privacy` and `/terms`, confirm they load and
   the disclaimer banner is visible.
4. **Feedback**: submit one from the dashboard, confirm it's in the
   `feedback` table and (if configured) the notification email arrives.
5. **Help page**: visit `/help`, confirm sections expand/collapse.
6. **Onboarding**: on a fresh test business, confirm the checklist shows
   incomplete steps and updates as you complete them for real (add a
   product, etc.) — not just when you click something in the checklist
   itself.
7. **Export/Import**: export your data from the Backups page, then try
   importing a small CSV of test customers on the Customers page.
8. **Migrations**: check the Diagnostics page shows "Stage 27" as the
   latest applied migration.
9. **E2E tests**: `npm run test:e2e` — the `public` project should pass
   with zero setup; `authenticated` will skip cleanly until you've set
   `E2E_TEST_PHONE`/`E2E_TEST_OTP` per `e2e/README.md`.

## What's deliberately left out of this stage

- **Session Replay, performance budgets, or alerting rules in
  Sentry** — the SDK is wired up and capturing errors; configuring
  *what* triggers a Slack/email alert and at what threshold is a Sentry
  dashboard setting, not application code, and reasonably left to your
  own judgment once you're seeing real error volume.
- **A true binary database backup** — repeating the point in Section 2
  because it matters: this stage's backup is a logical JSON export, a
  supplement to (not a replacement for) Supabase's own PITR/backup
  offering.
- **Multi-language legal pages** — Privacy Policy and Terms are English
  only, matching the rest of the app.
- **A full admin dashboard for reviewing feedback** — submissions land
  in the `feedback` table and your inbox; a proper in-app review UI
  (marking items resolved, replying) is a reasonable follow-up once
  volume justifies it.
- **Step-by-step spotlight/tour-style onboarding** (highlighting UI
  elements, "click here next") — the checklist points at the right
  pages but doesn't walk someone through *within* a page. A heavier
  tour library was judged not worth the added dependency for what a
  clear checklist already mostly accomplishes.
- **CSV import for expenses or invoices** — only Products and Customers
  got bulk import, since they're the two kinds of records a business
  realistically already has a list of before ever touching Reseeti.
  Expenses and invoices are typically created going forward, not
  bulk-imported from history.
- **CI workflow files for the E2E suite** — the tests and config are
  ready for CI (see `playwright.config.js`'s `CI` env var handling), but
  the actual workflow file depends on where your secrets and deployment
  live, which varies too much by setup to generalize usefully here.
- **Field-level import validation beyond "is it present"** — the import
  flow checks required fields exist, not that a phone number is
  correctly formatted or a price is a sensible number. Reasonable next
  hardening once real-world import files reveal what actually goes
  wrong in practice.
