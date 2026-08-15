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

// Starts a one-off transaction for a given amount. Reseeti's 3 tiers
// (monthly/6-month/12-month — see lib/planTiers.js) are each a single
// upfront charge, not a Paystack recurring Plan; a business just gets
// prompted to pay again once plan_renews_at passes, the same model
// OPay and Monnify already use here. amountKobo is required; planCode
// is optional purely for backward compatibility with an existing
// Paystack Plan object, if one is ever wanted again later — passing it
// makes Paystack silently override amountKobo with the plan's own
// price, same caveat as before.
export function initializeTransaction({ email, amountKobo, planCode, callbackUrl, metadata }) {
  const body = {
    email,
    amount: amountKobo,
    callback_url: callbackUrl,
    metadata,
  };
  if (planCode) body.plan = planCode;
  return paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function verifyTransaction(reference) {
  return paystackFetch(`/transaction/verify/${reference}`);
}
