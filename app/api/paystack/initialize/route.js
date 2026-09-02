import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { initializeTransaction } from '../../../../lib/paystack';
import { getTier } from '../../../../lib/planTiers';

export async function POST(request) {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { email, tier } = await request.json();
  if (!email) {
    return NextResponse.json({ error: 'Email is required by Paystack for billing' }, { status: 400 });
  }
  const tierRow = await getTier(tier);
  if (!tierRow) {
    return NextResponse.json({ error: 'Invalid plan tier' }, { status: 400 });
  }

  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }
  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only the business owner can manage billing and subscriptions.' }, { status: 403 });
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', membership.businessId)
    .single();

  // Save the email against the business so the webhook can match the
  // Paystack customer back to this business later.
  await supabase.from('businesses').update({ email }).eq('id', business.id);

  // Referral discount: one-time 20% off, only on the annual tier
  // (months === 12 — identified by duration rather than a hardcoded
  // tier id, since tiers are admin-configurable and their ids aren't
  // fixed strings), only if this business has actually earned one (see
  // schema_referrals.sql). Not consumed here — only a successful
  // payment should ever spend it, so app/api/paystack/webhook is what
  // actually decrements it, once charge.success genuinely fires.
  const isAnnual = tierRow.months === 12;
  const discountApplied = isAnnual && business.available_referral_discounts > 0;
  const amountNaira = discountApplied ? tierRow.amount_naira * 0.8 : tierRow.amount_naira;

  try {
    const result = await initializeTransaction({
      email,
      amountKobo: Math.round(amountNaira * 100),
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?payment=success`,
      // tier travels through to the webhook via metadata so it knows how
      // far forward to push plan_renews_at and which plan_interval to record.
      // discount_applied tells the webhook to actually spend the credit
      // only once this specific, discounted payment succeeds.
      metadata: { business_id: business.id, tier, discount_applied: discountApplied },
    });

    return NextResponse.json({ authorization_url: result.data.authorization_url });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
