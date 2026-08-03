import crypto from 'crypto';
import { timingSafeEqualHex } from './crypto';

// OPay Cashier (Checkout) integration.
// Docs: https://doc.opaycheckout.com/
//
// OPay uses two different auth schemes depending on the endpoint:
//   - Cashier Create (starting a payment): "Authorization: Bearer {PublicKey}"
//   - Everything else (status, refund, close): "Authorization: Bearer {signature}"
//     where {signature} is an HMAC-SHA512 of the JSON body, signed with your
//     Private Key, alongside a "MerchantId" header.
//
// IMPORTANT: OPay's published docs are inconsistent about the exact webhook
// signature format across API versions (some pages call it SHA-512, others
// SHA3-512; field casing also differs between the "v1" and legacy docs).
// verifyCallbackSignature() below follows the most current "Payment
// Notifications Callbacks" page, but confirm it against a real test
// transaction from your OPay merchant dashboard before relying on it in
// production — and consider also restricting the webhook route to OPay's
// published IP ranges as a second layer of defense.

const OPAY_BASE = process.env.OPAY_ENV === 'live'
  ? 'https://api.opaycheckout.com'
  : 'https://testapi.opaycheckout.com';

export async function initializeCashier({
  amountKobo,
  reference,
  returnUrl,
  callbackUrl,
  cancelUrl,
  customerEmail,
  customerName,
  customerPhone,
  productName,
  productDescription,
}) {
  const res = await fetch(`${OPAY_BASE}/api/v1/international/cashier/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPAY_PUBLIC_KEY}`,
      MerchantId: process.env.OPAY_MERCHANT_ID,
    },
    body: JSON.stringify({
      country: 'NG',
      reference,
      amount: { total: amountKobo, currency: 'NGN' },
      returnUrl,
      callbackUrl,
      cancelUrl,
      product: { name: productName, description: productDescription },
      userInfo: {
        userEmail: customerEmail,
        userName: customerName,
        ...(customerPhone ? { userMobile: customerPhone } : {}),
      },
      evokeOpay: true,
    }),
  });

  const data = await res.json();
  if (data.code !== '00000') {
    throw new Error(data.message || 'OPay cashier create failed');
  }
  return data.data; // { reference, orderNo, cashierUrl, status, amount }
}

// Verifies the `sha512` field OPay sends alongside webhook callbacks.
// Sign string format (order and casing matter):
//   {Amount:"...",Currency:"...",Reference:"...",Refunded:t/f,Status:"...",Timestamp:"...",Token:"...",TransactionID:"..."}
export function verifyCallbackSignature(payload, providedSignature) {
  const signString = `{Amount:"${payload.amount}",Currency:"${payload.currency}",Reference:"${payload.reference}",Refunded:${payload.refunded ? 't' : 'f'},Status:"${payload.status}",Timestamp:"${payload.timestamp}",Token:"${payload.token}",TransactionID:"${payload.transactionId}"}`;
  const expected = crypto.createHmac('sha512', process.env.OPAY_SECRET_KEY).update(signString).digest('hex');
  return timingSafeEqualHex(expected, providedSignature);
}
