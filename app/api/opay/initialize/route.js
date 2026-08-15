import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { initializeCashier } from '../../../../lib/opay';
import { getTier } from '../../../../lib/planTiers';

export async function POST(request) {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { email, tier } = await request.json();
  if (!email) {
    return NextResponse.json({ error: 'Email is required by OPay for billing' }, { status: 400 });
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

  await supabase.from('businesses').update({ email }).eq('id', business.id);

  // OPay's Cashier Create API has no metadata field, so both business_id
  // and tier are embedded directly in the reference instead — the webhook
  // parses them back out. Tier ids are admin-chosen slugs (see the
  // /admin plan-tiers UI) restricted to lowercase letters/digits/hyphens
  // specifically so they stay unambiguous inside this '__'-delimited
  // reference format — enforced in app/api/admin/plan-tiers/route.js.
  const reference = `opay_sub__${tier}__${business.id}__${Date.now()}`;

  try {
    const result = await initializeCashier({
      amountKobo: Math.round(tierRow.amount_naira * 100),
      reference,
      returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?payment=success`,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/opay/webhook`,
      cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      customerEmail: email,
      customerName: business.name,
      customerPhone: business.phone,
      productName: `Reseeti Pro subscription — ${tierRow.label}`,
      productDescription: `Reseeti Pro (${tierRow.label}) — unlimited invoices`,
    });

    return NextResponse.json({ cashier_url: result.cashierUrl });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
