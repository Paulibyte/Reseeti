const { test: setup, expect } = require('@playwright/test');

const AUTH_FILE = 'e2e/.auth/user.json';

// Reseeti's login has no password — it's phone number + one-time SMS
// code, optionally a second TOTP step if 2FA is on. A test runner can't
// receive a real SMS, so this depends on Supabase's own "test phone
// numbers" feature (Authentication → Providers → Phone, in your
// Supabase project dashboard): configure E2E_TEST_PHONE there with a
// fixed OTP code, set that same code as E2E_TEST_OTP here, and Supabase
// accepts it without ever sending a real SMS. This tests the actual
// login UI end-to-end (typing a phone number, typing a code) rather
// than bypassing it with a manufactured session — worth the one-time
// dashboard setup for that.
//
// Leave E2E_TEST_PHONE unset to skip every authenticated test entirely
// rather than have them all fail confusingly — see e2e/README.md.
setup('authenticate', async ({ page }) => {
  const phone = process.env.E2E_TEST_PHONE;
  const otp = process.env.E2E_TEST_OTP;
  setup.skip(!phone || !otp, 'E2E_TEST_PHONE / E2E_TEST_OTP not set — see e2e/README.md');

  await page.goto('/login');
  await page.getByPlaceholder('8012345678').fill(phone.replace(/^\+?234/, '').replace(/^0/, ''));
  await page.getByRole('button', { name: /continue/i }).click();

  // Six individual OTP digit boxes — see app/login/page.js's otpDigits
  // state, one <input> per digit.
  const digits = otp.split('');
  const otpInputs = page.locator('input[inputmode="numeric"][maxlength="1"]');
  for (let i = 0; i < digits.length; i++) {
    await otpInputs.nth(i).fill(digits[i]);
  }
  await page.getByRole('button', { name: /verify/i }).click();

  // A successful login lands on /dashboard — if 2FA is enabled for this
  // test account, this will instead sit on the 6-digit 2FA step, which
  // this setup deliberately doesn't handle (keep the E2E test account
  // free of 2FA, same as you'd keep it free of anything else that adds
  // manual-only friction to an automated flow).
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
