import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { initializeTransaction } from '../../../../lib/monnify';

export async function POST(request) {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { email } = await request.json();
  if (!email) {
    return NextResponse.json({ error: 'Email is required by Monnify for billing' }, { status: 400 });
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

  const paymentReference = `monnify_sub_${business.id}_${Date.now()}`;

  try {
    const result = await initializeTransaction({
      amount: 1500.0, // ₦1,500 — Monnify takes naira, not kobo (unlike Paystack/OPay)
      customerName: business.name,
      customerEmail: email,
      paymentReference,
      paymentDescription: 'Reseeti Pro subscription',
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?payment=success`,
      metaData: { business_id: business.id },
    });

    return NextResponse.json({ checkout_url: result.checkoutUrl });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
