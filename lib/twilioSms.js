// Sends plain SMS via Twilio's REST API directly (fetch + Basic Auth),
// matching the same no-SDK pattern lib/paystack.js already uses for
// Paystack, rather than adding the Twilio Node SDK as a dependency for
// one endpoint.
//
// IMPORTANT — this is intentionally separate from the Twilio integration
// that already exists for phone-login OTPs. That one is configured
// entirely inside Supabase's dashboard (Authentication → Providers →
// Phone), and Supabase never exposes those credentials back to this app's
// code. Sending an arbitrary SMS (not a login OTP) requires this app to
// hold its own Twilio Account SID / Auth Token / sending number as env
// vars — see README_STAGE16.md for setup, including reusing the same
// Twilio account if you want to.

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

export async function sendSms({ to, body }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    throw new Error('Twilio SMS is not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)');
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const params = new URLSearchParams({ To: to, From: from, Body: body });

  const res = await fetch(`${TWILIO_BASE}/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Twilio SMS failed (status ${res.status})`);
  }
  return data;
}

// Converts a Nigerian local number (08012345678) to E.164 format
// (+2348012345678) — same conversion used at login, kept here too since
// customer phone numbers are often stored however they were typed.
export function toE164(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.startsWith('0')) return '+234' + digits.slice(1);
  if (digits.startsWith('234')) return '+' + digits;
  if (digits.startsWith('+')) return digits;
  return '+234' + digits;
}
