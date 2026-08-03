// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// BASE_URL defaults to local dev — point it at a real deployment
// (staging, or production if you're brave) by setting the env var
// before running tests. See e2e/README.md for full setup, including why
// the authenticated tests need their own setup step (Reseeti's phone-OTP
// login can't be automated by literally receiving an SMS in a test
// runner).
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

module.exports = defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Unauthenticated smoke tests — no setup needed, run anywhere,
    // anytime, against any deployment.
    {
      name: 'public',
      testMatch: /public\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Authenticated flows — depend on the auth setup project below,
    // which needs SUPABASE_SERVICE_ROLE_KEY and E2E_TEST_PHONE set (see
    // e2e/README.md). Skipped automatically if that setup fails, rather
    // than every authenticated test failing individually with a
    // confusing "not logged in" error.
    {
      name: 'auth-setup',
      testMatch: /auth\.setup\.js/,
    },
    {
      name: 'authenticated',
      testMatch: /authenticated\/.*\.spec\.js/,
      dependencies: ['auth-setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
    },
  ],
  // Starts the dev server automatically for local runs; skipped when
  // E2E_BASE_URL points at an already-running deployment.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
