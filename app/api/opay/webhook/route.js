import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { verifyCallbackSignature } from '../../../../lib/opay';
import { renewsAtForMonths, getTier } from '../../../../lib/planTiers';

export async function POST(request) {
  const body = await request.json();
  const { payload, sha512 } = body;

  if (!payload || !sha512 || !verifyCallbackSignature(payload, sha512)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // tier and business_id were both embedded in the reference at
  // initialize time — see app/api/opay/initialize/route.js. Tier ids
  // are restricted to lowercase letters/digits/hyphens when created in
  // /admin (see plan-tiers/route.js), which is what makes matching them
  // explicitly here (rather than greedily like business_id) unambiguous.
  const match = /^opay_sub__([a-z0-9-]+)__(.+)__\d+$/.exec(payload.reference || '');
  const tier = match?.[1] || null;
  const businessId = match?.[2] || null;

  const supabase = createAdminClient();

  await supabase.from('payment_events').insert({
    business_id: businessId,
    event_type: `opay.${(payload.status || 'unknown').toLowerCase()}`,
    reference: payload.reference,
    amount: payload.amount ? Number(payload.amount) / 100 : null,
    raw_payload: body,
  });

  if (payload.status === 'SUCCESS' && businessId && tier) {
    const tierRow = await getTier(tier);
    if (tierRow) {
      await supabase.from('businesses').update({
        plan: 'pro',
        plan_interval: tier,
        plan_renews_at: renewsAtForMonths(tierRow.months).toISOString(),
        // See the same field in the Paystack webhook — clears any grace
        // period a previously-failed payment attempt had started.
        plan_grace_until: null,
      }).eq('id', businessId);

      await supabase.from('events').insert({
        business_id: businessId,
        event_type: 'upgrade_completed',
        metadata: { reference: payload.reference, gateway: 'opay', tier },
      });
    }
  }

  // OPay only checks the HTTP status code on callbacks, not the response
  // body — anything outside 2xx causes it to keep retrying for 72 hours.
  return NextResponse.json({ received: true });
}
