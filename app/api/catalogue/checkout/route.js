import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { rateLimit, requestIp } from '../../../../lib/rateLimit';
import { initializeTransaction } from '../../../../lib/paystack';

// Same "trust nothing from the client" posture as /api/catalogue/orders
// (the WhatsApp-order path) — every price is read fresh from the
// database here too, never taken from the request body. The one thing
// this route adds on top: it refuses to even attempt checkout unless
// the business has a paystack_subaccount_code (Stage 46) — no
// subaccount means no verified path for the money to reach them, so
// "Pay Now" simply shouldn't be offered by the UI in that case, and
// this is the server-side backstop if it somehow is anyway.
export async function POST(req) {
  const { allowed } = await rateLimit(`catalogue-checkout:${requestIp(req)}`, { limit: 10, windowSeconds: 3600 });
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests — please try again shortly.' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const { slug, customerPhone, customerName, customerEmail, items } = body;

  if (!slug || typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  }
  if (!customerPhone || String(customerPhone).replace(/\D/g, '').length < 7) {
    return NextResponse.json({ error: 'A valid phone number is required' }, { status: 400 });
  }
  if (!customerEmail || !/^\S+@\S+\.\S+$/.test(customerEmail)) {
    return NextResponse.json({ error: 'A valid email is required for payment receipts' }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
  }
  if (items.length > 50) {
    return NextResponse.json({ error: 'Too many items in one order' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: business } = await admin
    .from('businesses')
    .select('id, plan, catalogue_enabled, paystack_subaccount_code')
    .eq('catalogue_slug', slug)
    .maybeSingle();

  if (!business || !business.catalogue_enabled || business.plan !== 'pro') {
    return NextResponse.json({ error: 'This shop is not currently accepting orders.' }, { status: 404 });
  }
  if (!business.paystack_subaccount_code) {
    return NextResponse.json({ error: 'Online payment is not set up for this shop yet.' }, { status: 400 });
  }

  const productIds = [...new Set(items.map((it) => it.productId).filter(Boolean))];
  const { data: products } = await admin
    .from('products')
    .select('id, name, price, unit, unit_value')
    .eq('business_id', business.id)
    .eq('show_in_catalogue', true)
    .in('id', productIds);

  const productMap = Object.fromEntries((products || []).map((p) => [p.id, p]));

  const orderItems = [];
  let total = 0;
  for (const it of items) {
    const product = productMap[it.productId];
    const qty = Number(it.qty);
    if (!product || !Number.isFinite(qty) || qty <= 0 || qty > 1000) continue;
    orderItems.push({ product_id: product.id, name: product.name, unit: product.unit, unit_value: product.unit_value, qty, price: product.price });
    total += product.price * qty;
  }

  if (orderItems.length === 0) {
    return NextResponse.json({ error: 'None of the items in this cart are currently available.' }, { status: 400 });
  }
  // Paystack rejects sub-₦1 transactions outright, but a more useful
  // floor for a real order: guards against a near-empty cart slipping
  // through to a live payment attempt.
  if (total < 100) {
    return NextResponse.json({ error: 'Order total is too small to check out.' }, { status: 400 });
  }

  const { data: order, error: insertError } = await admin
    .from('catalogue_orders')
    .insert({
      business_id: business.id,
      customer_name: (customerName || '').trim().slice(0, 100) || null,
      customer_phone: String(customerPhone).replace(/\D/g, ''),
      items: orderItems,
      total,
      payment_status: 'pending_payment',
    })
    .select('id')
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  try {
    const result = await initializeTransaction({
      email: customerEmail,
      amountKobo: Math.round(total * 100),
      subaccountCode: business.paystack_subaccount_code,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/shop/${slug}/thank-you`,
      // order_id (not tier) is what the webhook uses to tell a catalogue
      // payment apart from a subscription payment — see
      // app/api/paystack/webhook/route.js.
      metadata: { order_id: order.id, catalogue_slug: slug },
    });
    return NextResponse.json({ authorization_url: result.data.authorization_url });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
