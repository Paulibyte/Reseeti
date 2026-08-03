import crypto from 'crypto';
import { timingSafeEqualHex } from './crypto';

// Monnify integration — this is Moniepoint's actual developer-facing
// payment gateway product (the "Moniepoint" consumer/business banking app
// itself does not expose a public payments API; Monnify is the brand
// TeamApt/Moniepoint offers to businesses for card, transfer and USSD
// collections). Docs: https://developers.monnify.com/

const MONNIFY_BASE = process.env.MONNIFY_ENV === 'live'
  ? 'https://api.monnify.com'
  : 'https://sandbox.monnify.com';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

// Monnify's OAuth2 access tokens are short-lived. Cached in memory per
// server process rather than re-authenticating on every call — this is a
// best-effort cache only (a serverless/multi-instance deployment will have
// one cache per instance), which is fine since re-authenticating is cheap
// and idempotent.
async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;

  const basic = Buffer.from(`${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`).toString('base64');
  const res = await fetch(`${MONNIFY_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!data.requestSuccessful) {
    throw new Error(data.responseMessage || 'Monnify authentication failed');
  }

  cachedToken = data.responseBody.accessToken;
  // Refresh a little early rather than waiting for a live request to 401.
  cachedTokenExpiresAt = Date.now() + (data.responseBody.expiresIn - 60) * 1000;
  return cachedToken;
}

// amount is in NAIRA here (e.g. 1500.00), not kobo — unlike Paystack/OPay.
export async function initializeTransaction({
  amount,
  customerName,
  customerEmail,
  paymentReference,
  paymentDescription,
  redirectUrl,
  metaData,
}) {
  const token = await getAccessToken();
  const res = await fetch(`${MONNIFY_BASE}/api/v1/merchant/transactions/init-transaction`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      customerName,
      customerEmail,
      paymentReference,
      paymentDescription,
      currencyCode: 'NGN',
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      redirectUrl,
      paymentMethods: ['CARD', 'ACCOUNT_TRANSFER'],
      metaData,
    }),
  });

  const data = await res.json();
  if (!data.requestSuccessful) {
    throw new Error(data.responseMessage || 'Monnify transaction initialization failed');
  }
  return data.responseBody; // { checkoutUrl, transactionReference, paymentReference, ... }
}

// Monnify signs webhook bodies and sends the result in the
// 'monnify-signature' header, computed as HMAC-SHA512 of the raw request
// body using your Secret Key.
export function verifyWebhookSignature(rawBody, signatureHeader) {
  const expected = crypto.createHmac('sha512', process.env.MONNIFY_SECRET_KEY).update(rawBody).digest('hex');
  return timingSafeEqualHex(expected, signatureHeader);
}
