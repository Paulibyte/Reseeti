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
export function initializeTransaction({ email, amountKobo, planCode, callbackUrl, metadata, subaccountCode }) {
  const body = {
    email,
    amount: amountKobo,
    callback_url: callbackUrl,
    metadata,
  };
  if (planCode) body.plan = planCode;
  // Catalogue checkout only (never set for a subscription payment) —
  // routes settlement straight to the business's own bank account via
  // their registered Subaccount, instead of Reseeti's own Paystack
  // balance. percentage_charge on the subaccount itself (set to 0 at
  // creation — see createSubaccount below) is what makes 100% of the
  // payment go to the business; Reseeti's account never holds it even
  // momentarily. See schema_stage46.sql for the full reasoning.
  if (subaccountCode) body.subaccount = subaccountCode;
  return paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function verifyTransaction(reference) {
  return paystackFetch(`/transaction/verify/${reference}`);
}

// ---------------------------------------------------------------------
// Marketplace / catalogue-checkout support (Stage 46) — lets a customer
// pay a business directly through Paystack Subaccounts, so Reseeti's
// own Paystack account (used above for subscription billing) never
// touches or holds a business's actual sales revenue. See
// schema_stage46.sql for the full design reasoning.
// ---------------------------------------------------------------------

export function listBanks() {
  return paystackFetch('/bank?country=nigeria&currency=NGN&perPage=100');
}

// Paystack's own guidance: verify account details actually match
// before creating a subaccount with them — Paystack explicitly won't
// take responsibility for a payout sent to the wrong account otherwise.
export function resolveAccountNumber({ accountNumber, bankCode }) {
  return paystackFetch(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
}

// percentageCharge is what goes to Reseeti's own main account — fixed
// at 0 everywhere this is called from, meaning 100% of every catalogue
// sale settles to the business's own bank account. Left as a parameter
// (not hardcoded) so a platform commission could be introduced later
// without changing this function's shape, but nothing in this codebase
// currently passes anything other than 0.
export function createSubaccount({ businessName, bankCode, accountNumber, percentageCharge = 0 }) {
  return paystackFetch('/subaccount', {
    method: 'POST',
    body: JSON.stringify({
      business_name: businessName,
      bank_code: bankCode,
      account_number: accountNumber,
      percentage_charge: percentageCharge,
    }),
  });
}
