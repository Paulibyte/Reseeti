import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function POST(request) {
  const { phone, code } = await request.json();
  if (!phone || !code) {
    return Response.json({ error: 'Phone and code are required.' }, { status: 400 });
  }
  const digits = phone.replace(/\D/g, '');
  const e164 = digits.startsWith('0') ? `+234${digits.slice(1)}` : `+${digits}`;

  try {
    const check = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: e164, code });

    if (check.status !== 'approved') {
      return Response.json({ error: 'Incorrect or expired code.' }, { status: 400 });
    }
    return Response.json({ verified: true });
  } catch (err) {
    return Response.json({ error: 'Incorrect or expired code.', code: err.code }, { status: 400 });
  }
}
