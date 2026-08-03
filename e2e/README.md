# End-to-end tests

Playwright, covering two tiers:

- **`e2e/public/`** — no login needed. Runs anywhere, anytime, against
  any deployment, with zero setup beyond `npx playwright install`.
- **`e2e/authenticated/`** — needs a real logged-in session. See
  "Authenticated tests" below before these will run at all; they're
  skipped (not failed) without that setup.

## Quick start

```bash
npm install
npx playwright install --with-deps
npm run test:e2e
```

Runs against `http://localhost:3000` by default, starting the dev
server automatically. Point it at a real deployment instead:

```bash
E2E_BASE_URL=https://your-deployment.vercel.app npm run test:e2e
```

`npm run test:e2e:ui` opens Playwright's interactive UI mode — the
fastest way to watch a test run step by step and see exactly where it
fails.

## Authenticated tests

Reseeti has no password — sign-in is a phone number plus a one-time SMS
code. A test runner obviously can't receive a real text message, so
authenticated tests depend on Supabase Auth's own **test phone numbers**
feature rather than a manufactured/bypassed session:

1. In your Supabase project dashboard: **Authentication → Providers →
   Phone**, add a test phone number with a fixed OTP code (Supabase's
   own docs cover this — it's built for exactly this situation, and the
   fixed code works without ever sending a real SMS).
2. Set both as environment variables before running tests:
   ```bash
   E2E_TEST_PHONE=+2348000000000
   E2E_TEST_OTP=123456
   ```
3. Keep **two-factor authentication turned off** for this specific test
   account — `e2e/auth.setup.js` only handles the phone+OTP step, the
   same way you'd keep a CI service account free of any other
   manual-only step.

`e2e/auth.setup.js` runs once before the `authenticated` test project,
logs in through the real UI (typing the phone number, typing the OTP —
this exercises the actual login flow, not a shortcut around it), and
saves the resulting session to `e2e/.auth/user.json` for every
authenticated test to reuse. That file is gitignored — regenerated
fresh each run, never committed.

Without `E2E_TEST_PHONE`/`E2E_TEST_OTP` set, the setup step skips itself
and every authenticated test skips along with it — you'll see
"skipped," not a wall of confusing failures.

## Testing against a receipt page

`e2e/public/smoke.spec.js` includes one test for the public `/inv/[id]`
receipt page, gated behind `E2E_TEST_INVOICE_ID` (a real invoice ID from
your test data) for the same reason as above — skipped cleanly if unset.

## What's covered vs. not

This is a starting suite, not exhaustive coverage of everything built
across 27 stages — see README_STAGE27.md's "what's deliberately left
out" for the honest scope. It covers the shape of testing this app
(public pages, the login flow, opening the core forms) rather than every
button and edge case. Real invoice creation-and-verification, offline
queue behavior, multi-device sync, and payment webhook flows are all
harder to test safely and repeatably without a dedicated, resettable
test environment — reasonable next additions once one exists, not
attempted here against what might be a real database.

## CI

No CI workflow file is included — wiring this into GitHub Actions (or
whatever you use) depends on where `E2E_TEST_PHONE`/`E2E_TEST_OTP` and
`E2E_BASE_URL` actually live for your deployment, which varies enough by
setup that a generic workflow file would need editing anyway. The
`reporter: process.env.CI ? 'github' : 'html'` line in
`playwright.config.js` is ready for it — set a `CI` env var and add
whichever CI platform's workflow file fits your setup.
