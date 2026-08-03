import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { initializeCashier } from '../../../../lib/opay';

export async function POST(request) {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { email } = await request.json();
  if (!email) {
    return NextResponse.json({ error: 'Email is required by OPay for billing' }, { status: 400 });
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

  // OPay's Cashier Create API has no metadata field, so the business_id is
  // embedded directly in the reference instead — the webhook parses it back
  // out. '__' is used as the delimiter since business_id (a UUID) already
  // contains hyphens.
  const reference = `opay_sub__${business.id}__${Date.now()}`;

  try {
    const result = await initializeCashier({
      amountKobo: 150000, // ₦1,500 — keep in sync with the Pro plan price used for Paystack/Monnify
      reference,
      returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?payment=success`,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/opay/webhook`,
      cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
      customerEmail: email,
      customerName: business.name,
      customerPhone: business.phone,
      productName: 'Reseeti Pro subscription',
      productDescription: 'Monthly Reseeti Pro plan — unlimited invoices',
    });

    return NextResponse.json({ cashier_url: result.cashierUrl });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
