// Sends real WhatsApp messages via Meta's WhatsApp Business Cloud API —
// distinct from the wa.me links used elsewhere in the app (dashboard
// "Remind" button, receipt page's Share button), which just open
// WhatsApp with a pre-filled message for a human to review and send by
// hand. This sends automatically, no tap required, which is what makes
// it usable for the unattended reminder cron
// (app/api/reminders/send/route.js) the same way lib/twilioSms.js
// already does for SMS.
//
// Uses one global, platform-level WhatsApp Business number (env vars
// below) — the same shape as the existing Twilio/Resend/Paystack
// integrations, which all send FROM Reseeti's own configured
// account/number rather than requiring each business to bring their own
// API credentials. See README_STAGE24.md for full setup.

const GRAPH_API_VERSION = 'v21.0';

// WhatsApp's platform rule, not a Reseeti choice: a business can only
// send freeform text to a customer within 24 hours of that customer
// last messaging them. Outside that window (which is the normal case
// for an unprompted payment reminder — the customer didn't just message
// Reseeti), only a pre-approved message TEMPLATE can be sent. This is
// why sendReminderTemplate exists as the primary path rather than a
// plain sendText — see README_STAGE24.md for how to get a template
// approved in Meta Business Manager.
export async function sendWhatsAppTemplate({ to, templateName, languageCode = 'en', params = [] }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error('WhatsApp is not configured (missing WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)');
  }

  const body = {
    messaging_product: 'whatsapp',
    to: toWhatsAppFormat(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: params.length
        ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }]
        : [],
    },
  };

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `WhatsApp API failed (status ${res.status})`);
  }
  return data;
}

// Freeform text — only actually deliverable within WhatsApp's 24-hour
// customer-initiated session window (see above). Kept available for a
// future flow where the customer messages the business first (e.g. a
// "chat with us" link), but the reminder cron always uses the template
// path since it initiates contact, not the customer.
export async function sendWhatsAppText({ to, body: text }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error('WhatsApp is not configured (missing WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)');
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toWhatsAppFormat(to),
      type: 'text',
      text: { body: text },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `WhatsApp API failed (status ${res.status})`);
  }
  return data;
}

// WhatsApp wants digits only, no leading '+' (unlike Twilio's E.164) —
// same Nigerian-local-number assumption as lib/twilioSms.js's toE164.
export function toWhatsAppFormat(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.startsWith('0')) return '234' + digits.slice(1);
  if (digits.startsWith('234')) return digits;
  return digits;
}
