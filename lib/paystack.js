const PAYSTACK_BASE = 'https://api.paystack.co';

async function paystackFetch(path, options = {}) {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok || data.status === false) {
    throw new Error(data.message || 'Paystack request failed');
  }
  return data;
}

// Starts a transaction against a recurring Plan. Paystack automatically
// creates the customer + subscription on first successful charge, then
// bills the same authorization every month going forward — the business
// owner doesn't need to re-enter card details.
//
// Note: Paystack still requires `amount` in the request body even when a
// `plan` is supplied — the plan's price silently overrides it, but the
// field can't be omitted or the API rejects the call with
// "Invalid Amount Sent". Keep this in sync with the Plan's price in kobo.
export function initializeTransaction({ email, planCode, callbackUrl, metadata }) {
  return paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email,
      amount: 150000, // ₦1,500 in kobo — ignored in favor of the plan's price, but required
      plan: planCode,
      callback_url: callbackUrl,
      metadata,
    }),
  });
}

export function verifyTransaction(reference) {
  return paystackFetch(`/transaction/verify/${reference}`);
}
