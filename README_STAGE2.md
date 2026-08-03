# Reseeti — Stage 2: Paystack subscriptions

This wires up real billing: businesses upgrade from Free to Pro
(₦1,500/month) through Paystack, and a webhook keeps their plan status in
sync automatically — no manual "did they pay?" checking.

## How the flow works

1. Business clicks **Upgrade to Pro** on the dashboard and enters an email
   (Paystack requires one for billing/receipts, even though login here is
   phone-only).
2. The app calls `POST /api/paystack/initialize`, which asks Paystack to
   start a transaction against your Pro **Plan**, and gets back a checkout
   URL.
3. Business is redirected to Paystack's hosted payment page, pays by card
   or bank transfer.
4. Paystack does two things after a successful payment:
   - Redirects the browser back to `/dashboard?payment=success`
   - Sends a `charge.success` webhook to your server — **this webhook is
     the source of truth**, not the redirect. The redirect just improves
     the user experience; someone could close the tab before it fires and
     still be correctly upgraded once the webhook lands.
5. The webhook handler verifies the request really came from Paystack
   (signature check), then updates `businesses.plan = 'pro'`.
6. Every month, Paystack automatically charges the same card and fires
   `charge.success` again, keeping `plan_renews_at` pushed forward. If a
   renewal fails repeatedly and the subscription is cancelled, Paystack
   fires `subscription.disable`, which the webhook uses to drop the
   business back to `'free'`.

## Setup

### 1. Run the migration
In the Supabase SQL editor, run `supabase/schema_stage2.sql` (after
Stage 1's `schema.sql`, if you haven't already).

### 2. Create a Paystack account and a Plan
- Sign up at paystack.com, business or individual account is fine to start
  with test mode.
- Go to **Payments > Plans > New Plan**. Set:
  - Name: `Reseeti Pro`
  - Amount: `1500` (NGN)
  - Interval: `Monthly`
- Copy the **Plan Code** (looks like `PLN_xxxxxxxx`) into your `.env.local`
  as `PAYSTACK_PRO_PLAN_CODE`.

### 3. Get your API keys
Settings > API Keys & Webhooks in the Paystack dashboard. Use the **Test**
secret/public keys while developing — test mode lets you pay with
Paystack's documented test card numbers, no real money moves.

### 4. Point the webhook at your app
Same Paystack settings page, add a webhook URL:
```
https://your-domain.com/api/paystack/webhook
```
Locally, you won't have a public URL — use a tool like `ngrok` to expose
your dev server temporarily (`ngrok http 3000`) and use the ngrok URL for
testing webhooks end to end.

### 5. Fill in `.env.local`
All the new variables are documented in `.env.local.example`.

### 6. Test the full loop
Use Paystack's test card (`4084084084084081`, any future expiry, CVV `408`,
PIN `0000`, OTP `123456`) to upgrade a test account and confirm:
- The dashboard shows "Reseeti Pro" after the redirect
- A row appears in `payment_events`
- `businesses.plan` is `'pro'` in the Supabase table editor

## What's deliberately simplified here
- **No proration or plan-switching UI** — there's only one paid tier, so
  upgrade is a single button. Add a cancel/downgrade flow when you have a
  reason to (Paystack supports subscription cancellation via API).
- **`plan_renews_at` is a rough +30 days**, not read from Paystack's exact
  next-billing-date. Fine for showing "renews around X" in the UI; don't
  rely on it for anything that needs to be precise to the day.
- **No dunning/retry messaging** — if a renewal fails, Paystack retries a
  few times automatically, but the business isn't proactively emailed or
  WhatsApp'd about it here. Worth adding once you have real subscribers.

## Next: Stage 3
Port PDF export and WhatsApp share from the original prototype into this
app, and add a public shareable invoice link (`/inv/[id]`) as a lighter
alternative to downloading a PDF.
