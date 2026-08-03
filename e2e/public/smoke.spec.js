const { test, expect } = require('@playwright/test');

test.describe('Public pages', () => {
  test('login page loads and shows the phone input', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('8012345678')).toBeVisible();
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible();
  });

  test('an unauthenticated visit to the dashboard redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('privacy policy page loads', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  });

  test('terms of service page loads', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  });

  test('help page loads and FAQ items expand', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { name: 'Help & FAQ' })).toBeVisible();
    const firstQuestion = page.getByText('How do I create my first invoice?');
    await expect(firstQuestion).toBeVisible();
    await firstQuestion.click();
    await expect(page.getByText(/AI Invoice Assistant/i)).toBeVisible();
  });

  test('manifest.json is reachable and valid', async ({ request }) => {
    const res = await request.get('/manifest.json');
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons?.length).toBeGreaterThan(0);
  });
});

test.describe('Public receipt page', () => {
  // A real invoice ID from your test data — set via env so this doesn't
  // hardcode a UUID from one specific database. Skipped entirely if
  // unset, same reasoning as the authenticated tests skipping without
  // E2E_TEST_PHONE.
  test('a shared invoice link renders a receipt', async ({ page }) => {
    const invoiceId = process.env.E2E_TEST_INVOICE_ID;
    test.skip(!invoiceId, 'E2E_TEST_INVOICE_ID not set — see e2e/README.md');

    await page.goto(`/inv/${invoiceId}`);
    await expect(page.getByText(/invoice/i).first()).toBeVisible();
  });
});
