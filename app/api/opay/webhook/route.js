import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { verifyCallbackSignature } from '../../../../lib/opay';

export async function POST(request) {
  const body = await request.json();
  const { payload, sha512 } = body;

  if (!payload || !sha512 || !verifyCallbackSignature(payload, sha512)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // business_id was embedded in the reference at initialize time — see
  // app/api/opay/initialize/route.js.
  const match = /^opay_sub__(.+)__\d+$/.exec(payload.reference || '');
  const businessId = match?.[1] || null;

  const supabase = createAdminClient();

  await supabase.from('payment_events').insert({
    business_id: businessId,
    event_type: `opay.${(payload.status || 'unknown').toLowerCase()}`,
    reference: payload.reference,
    amount: payload.amount ? Number(payload.amount) / 100 : null,
    raw_payload: body,
  });

  if (payload.status === 'SUCCESS' && businessId) {
    // A month of grace, same convention as the Paystack webhook — there's
    // no recurring-subscription concept on OPay's Cashier product, so
    // renewal here just means "prompt to pay again in 30 days."
    const renewsAt = new Date();
    renewsAt.setDate(renewsAt.getDate() + 30);

    await supabase.from('businesses').update({
      plan: 'pro',
      plan_renews_at: renewsAt.toISOString(),
      // See the same field in the Paystack webhook — clears any grace
      // period a previously-failed payment attempt had started.
      plan_grace_until: null,
    }).eq('id', businessId);

    await supabase.from('events').insert({
      business_id: businessId,
      event_type: 'upgrade_completed',
      metadata: { reference: payload.reference, gateway: 'opay' },
    });
  }

  // OPay only checks the HTTP status code on callbacks, not the response
  // body — anything outside 2xx causes it to keep retrying for 72 hours.
  return NextResponse.json({ received: true });
}
