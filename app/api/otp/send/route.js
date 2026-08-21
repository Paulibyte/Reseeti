import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function POST(request) {
  const { phone } = await request.json();

  if (!phone || typeof phone !== 'string') {
    return Response.json({ error: 'Phone number is required.' }, { status: 400 });
  }
  const digits = phone.replace(/\D/g, '');
  const e164 = digits.startsWith('0') ? `+234${digits.slice(1)}` : `+${digits}`;

  try {
    const verification = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: e164, channel: 'sms' });

    return Response.json({ status: verification.status });
  } catch (err) {
    return Response.json({ error: err.message, code: err.code }, { status: 400 });
  }
}
