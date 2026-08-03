const { test, expect } = require('@playwright/test');

test.describe('Dashboard', () => {
  test('loads and shows the stat cards', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText(/Invoices/i).first()).toBeVisible();
    await expect(page.getByText(/Outstanding/i)).toBeVisible();
    await expect(page.getByText(/Collected/i)).toBeVisible();
  });

  test('sidebar navigation reaches every core page', async ({ page }) => {
    await page.goto('/dashboard');
    for (const [label, urlPart] of [
      ['Inventory', '/dashboard/inventory'],
      ['Customers', '/dashboard/customers'],
      ['Expenses', '/dashboard/expenses'],
    ]) {
      await page.getByRole('link', { name: label }).click();
      await expect(page).toHaveURL(new RegExp(urlPart));
    }
  });
});

test.describe('Invoice creation', () => {
  test('can open the create-invoice form and add a freehand item', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /create invoice/i }).click();

    // The item row's description field — freehand items don't need to
    // match anything in inventory to be added.
    const descriptionInput = page.locator('input[placeholder*="tem" i]').first();
    await descriptionInput.fill('Test item — E2E run');

    const priceInput = page.locator('input[placeholder*="rice" i]').first();
    await priceInput.fill('1000');

    // Deliberately doesn't click Save — this test verifies the form
    // opens and accepts input correctly, not that it creates a real
    // invoice against whatever database this suite happens to be
    // pointed at. A full create-and-verify test is a reasonable
    // follow-up once there's a dedicated, safely-resettable test
    // business to run it against.
    await expect(priceInput).toHaveValue('1000');
  });
});

test.describe('Inventory', () => {
  test('can open Add Product and see the form fields', async ({ page }) => {
    await page.goto('/dashboard/inventory');
    await page.getByRole('button', { name: /add product/i }).click();
    await expect(page.getByText(/barcode/i)).toBeVisible();
  });
});

test.describe('Customers', () => {
  test('can open Add Customer and see the form fields', async ({ page }) => {
    await page.goto('/dashboard/customers');
    await page.getByRole('button', { name: /add customer/i }).click();
    await expect(page.locator('input[placeholder*="phone" i]').first()).toBeVisible();
  });
});

test.describe('Security page', () => {
  test('shows 2FA and session management sections', async ({ page }) => {
    await page.goto('/dashboard/security');
    await expect(page.getByText(/two-factor authentication/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /sign out of all other devices/i })).toBeVisible();
  });
});
