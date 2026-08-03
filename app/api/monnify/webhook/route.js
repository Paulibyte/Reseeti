import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { verifyWebhookSignature } from '../../../../lib/monnify';

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get('monnify-signature');

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const eventData = event.eventData || {};
  const businessId = eventData.metaData?.business_id || null;

  const supabase = createAdminClient();

  await supabase.from('payment_events').insert({
    business_id: businessId,
    event_type: `monnify.${event.eventType || 'unknown'}`,
    reference: eventData.paymentReference,
    amount: eventData.amountPaid ? Number(eventData.amountPaid) : null,
    raw_payload: event,
  });

  // Monnify's own docs recommend re-querying transaction status rather than
  // trusting the webhook body alone before crediting an account — worth
  // wiring up getTransactionStatus() as an extra check here once you have
  // real Monnify credentials to test against.
  if (event.eventType === 'SUCCESSFUL_TRANSACTION' && eventData.paymentStatus === 'PAID' && businessId) {
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
      metadata: { reference: eventData.paymentReference, gateway: 'monnify' },
    });
  }

  return NextResponse.json({ received: true });
}
