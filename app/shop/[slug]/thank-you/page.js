import { createAdminClient } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Reached via Paystack's callback_url after a checkout attempt (see
// app/api/catalogue/checkout/route.js) — Paystack redirects here
// regardless of outcome, appending ?reference=... itself, so status is
// looked up fresh rather than assumed from the redirect alone. The
// webhook (app/api/paystack/webhook/route.js) is what actually marks
// the order paid — this page just reads whatever that's already set by
// the time the customer lands here, which in practice is fast enough
// that the two are effectively simultaneous.
export default async function ThankYouPage({ params, searchParams }) {
  const supabase = createAdminClient();
  const reference = searchParams?.reference || searchParams?.trxref;

  const { data: business } = await supabase
    .from('businesses')
    .select('id, name, whatsapp_number, logo_url')
    .eq('catalogue_slug', params.slug)
    .maybeSingle();

  let order = null;
  if (business && reference) {
    const { data } = await supabase
      .from('catalogue_orders')
      .select('payment_status, total, customer_name')
      .eq('business_id', business.id)
      .eq('paystack_reference', reference)
      .maybeSingle();
    order = data;
  }

  const paid = order?.payment_status === 'paid';

  return (
    <main style={{ maxWidth: 420, margin: '0 auto', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px', fontFamily: 'sans-serif', background: '#faf6ef', textAlign: 'center' }}>
      <div>
        {business?.logo_url && (
          <img src={business.logo_url} alt="" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 10, marginBottom: 12 }} />
        )}
        <div style={{ fontSize: 48, marginBottom: 12 }}>{paid ? '✅' : '⏳'}</div>
        <h1 style={{ fontSize: 20, color: '#1a2a4a', margin: '0 0 8px' }}>
          {paid ? 'Payment received!' : 'Checking your payment…'}
        </h1>
        <p style={{ color: '#6b6255', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>
          {paid
            ? `Thanks${order?.customer_name ? `, ${order.customer_name}` : ''}! ${business?.name || 'The seller'} has been notified and will be in touch to arrange delivery or pickup.`
            : "We're confirming this with Paystack — if this doesn't update in a minute, contact the seller directly to confirm your order went through."}
        </p>
        {business?.whatsapp_number && (
          <a
            href={`https://wa.me/${business.whatsapp_number.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-block', background: '#25D366', color: '#fff', textDecoration: 'none', borderRadius: 10, padding: '12px 22px', fontWeight: 700, fontSize: 14 }}
          >
            Message {business.name} on WhatsApp
          </a>
        )}
      </div>
    </main>
  );
}
