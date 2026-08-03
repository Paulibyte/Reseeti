# Reseeti — Stage 7: OPay & Monnify as additional payment gateways

The Pro subscription upgrade (₦1,500/month) can now be paid for via **OPay**
or **Monnify**, alongside the existing Paystack option. All three show up as
a "Pay with" picker in the upgrade modal on the dashboard.

## Why Monnify and not "Moniepoint"
Moniepoint (the banking app) doesn't expose a public payments API for
businesses to integrate against directly. The product it offers for this —
accepting card/transfer/USSD payments on your own site — is **Monnify**, a
brand under the same company (TeamApt/Moniepoint). That's what's wired up
here.

## What's new
- **`lib/opay.js`** — starts an OPay Cashier (hosted checkout) session and
  verifies the HMAC-SHA512 signature OPay sends on webhook callbacks.
- **`lib/monnify.js`** — authenticates with Monnify's OAuth2 login endpoint,
  starts a Monnify checkout session, and verifies the `monnify-signature`
  header on webhooks.
- **`app/api/opay/initialize`**, **`app/api/opay/webhook`** — mirror the
  existing `app/api/paystack/*` routes. OPay's Cashier Create API has no
  metadata field, so the business being upgraded is identified by embedding
  its id directly in the payment reference (`opay_sub__<business_id>__<ts>`)
  rather than a separate lookup.
- **`app/api/monnify/initialize`**, **`app/api/monnify/webhook`** — same
  shape, but Monnify's API does support a `metaData` field, so `business_id`
  is passed there directly instead.
- Both webhooks log to the existing `payment_events` table (prefixing
  `event_type` with `opay.` / `monnify.` so all three gateways can share one
  table) and update `businesses.plan` / `plan_renews_at` on success, exactly
  like the Paystack webhook already did.
- The **Payments** dashboard page now shows which gateway each transaction
  came from, not just Paystack's.

## Setup

### OPay
1. Create an OPay merchant account and grab your Merchant ID, Public Key,
   and Secret (Private) Key from the dashboard's **API Keys & Webhooks**
   section.
2. Set your webhook/callback URL in the OPay dashboard to
   `https://your-domain.com/api/opay/webhook`.
3. Add `OPAY_MERCHANT_ID`, `OPAY_PUBLIC_KEY`, `OPAY_SECRET_KEY` to your env
   (see `.env.local.example`). Leave `OPAY_ENV=sandbox` until you're ready
   to go live.

### Monnify
1. Create a Monnify account, then grab your **API Key** and **Secret Key**
   from Settings, and your **Contract Code** from Settings > Contracts
   Setup.
2. Set your Transaction Completion webhook URL in the Monnify dashboard to
   `https://your-domain.com/api/monnify/webhook`.
3. Add `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE` to
   your env. Leave `MONNIFY_ENV=sandbox` until you're ready to go live.

## Worth knowing before going live
- **OPay's webhook signature format isn't fully pinned down.** OPay's own
  docs are inconsistent across pages/versions about the exact string that
  gets HMAC-signed for callbacks. `verifyCallbackSignature()` in
  `lib/opay.js` follows their most current published example — trigger a
  real sandbox transaction and confirm the signature actually matches
  before trusting it in production.
- **Monnify's docs recommend a belt-and-suspenders check**: after signature
  verification, re-query the transaction status via their API before
  crediting an account, rather than trusting the webhook body alone. That
  re-query isn't wired in yet (see the comment in
  `app/api/monnify/webhook/route.js`) — worth adding once you have real
  credentials to test against.
- **PalmPay was deliberately left out of this stage.** Its merchant
  API requires a formal partner application and manual key exchange via
  their merchant portal rather than a self-serve API key — there wasn't a
  reliable public integration to build against without that.
