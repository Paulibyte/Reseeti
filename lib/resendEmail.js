// Sends email via Resend's REST API directly (fetch + Bearer token),
// matching the same no-SDK pattern lib/twilioSms.js uses for Twilio and
// lib/paystack.js uses for Paystack, rather than adding another
// provider's Node SDK as a dependency for one endpoint.
//
// Resend requires a verified sending domain before it will deliver to
// arbitrary recipients — see README for setup. RESEND_FROM_EMAIL must be
// an address on that verified domain (e.g. invoices@yourbusiness.com),
// not a Gmail/Yahoo address.

const RESEND_BASE = 'https://api.resend.com';

export async function sendEmailWithAttachment({ to, subject, html, attachmentBase64, attachmentFilename }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error('Email is not configured (missing RESEND_API_KEY / RESEND_FROM_EMAIL)');
  }

  const res = await fetch(`${RESEND_BASE}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      attachments: attachmentBase64
        ? [{ filename: attachmentFilename, content: attachmentBase64 }]
        : undefined,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Resend request failed (status ${res.status})`);
  }
  return data;
}
