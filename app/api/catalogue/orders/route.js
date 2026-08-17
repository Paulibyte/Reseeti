import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { rateLimit, requestIp } from '../../../../lib/rateLimit';

// No auth check at all here on purpose — a customer browsing the public
// catalogue (app/shop/[slug]) has no Supabase session, by design. This
// is the one and only way a row ever lands in catalogue_orders (see
// schema_stage45.sql — there's no client-facing insert policy on that
// table). Every input is treated as untrusted: product ids and
// quantities are re-validated against the real business/products, and
// prices are read fresh from the database, never taken from the
// request body — a tampered client can't order a real item at a fake
// price.
export async function POST(req) {
  const { allowed } = await rateLimit(`catalogue-order:${requestIp(req)}`, { limit: 10, windowSeconds: 3600 });
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests — please try again shortly.' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const { slug, customerPhone, customerName, items } = body;

  if (!slug || typeof slug !== 'string') {
    return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  }
  if (!customerPhone || String(customerPhone).replace(/\D/g, '').length < 7) {
    return NextResponse.json({ error: 'A valid phone number is required' }, { status: 400 });
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
    .select('id, plan, catalogue_enabled')
    .eq('catalogue_slug', slug)
    .maybeSingle();

  // Same live re-check as the catalogue page itself (Stage 39/40) — a
  // business that's lapsed from Pro or turned the catalogue off
  // shouldn't be able to receive new orders even if someone still has
  // the page loaded from before that happened.
  if (!business || !business.catalogue_enabled || business.plan !== 'pro') {
    return NextResponse.json({ error: 'This shop is not currently accepting orders.' }, { status: 404 });
  }

  const productIds = [...new Set(items.map((it) => it.productId).filter(Boolean))];
  if (productIds.length === 0) {
    return NextResponse.json({ error: 'No valid items in cart' }, { status: 400 });
  }

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
    if (!product || !Number.isFinite(qty) || qty <= 0 || qty > 1000) continue; // silently drop anything invalid/tampered rather than fail the whole order
    orderItems.push({
      product_id: product.id,
      name: product.name,
      unit: product.unit,
      unit_value: product.unit_value,
      qty,
      price: product.price, // real, current price — never from the request
    });
    total += product.price * qty;
  }

  if (orderItems.length === 0) {
    return NextResponse.json({ error: 'None of the items in this cart are currently available.' }, { status: 400 });
  }

  const { data: order, error } = await admin
    .from('catalogue_orders')
    .insert({
      business_id: business.id,
      customer_name: (customerName || '').trim().slice(0, 100) || null,
      customer_phone: String(customerPhone).replace(/\D/g, ''),
      items: orderItems,
      total,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orderId: order.id });
}
