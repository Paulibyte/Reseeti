import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { initializeTransaction } from '../../../../lib/paystack';

const MIN_PAYMENT = 1000;

// Originally school-fee-only (app/api/school/fee-payment/route.js) —
// generalized to any invoice once the underlying need turned out not
// to be school-specific at all: a customer with an outstanding balance
// on any purchase can pay it down online, the same way a parent
// already could for a fee invoice. The only thing that changed is
// removing the student_id gate below; every other safeguard is
// unchanged. Deliberately public — the customer paying has no Reseeti
// account and no session, same as the WhatsApp catalogue checkout.
// Every number that actually matters (remaining balance, the minimum)
// is computed and enforced here, server-side, from the real
// invoice_payments already recorded — the amount the client sends is
// only ever a request, never trusted as fact.
export async function POST(req) {
  const { invoiceId, amount, email } = await req.json().catch(() => ({}));

  if (!invoiceId || !amount || !email) {
    return NextResponse.json({ error: 'Missing invoiceId, amount, or email' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, total, business_id, invoice_payments(amount)')
    .eq('id', invoiceId)
    .maybeSingle();

  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  const paidSoFar = (invoice.invoice_payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const remaining = Number(invoice.total) - paidSoFar;

  if (remaining <= 0) {
    return NextResponse.json({ error: 'This invoice is already fully paid' }, { status: 400 });
  }

  const requestedAmount = Number(amount);
  if (!Number.isFinite(requestedAmount) || requestedAmount < MIN_PAYMENT) {
    return NextResponse.json({ error: `Minimum payment is ₦${MIN_PAYMENT.toLocaleString()}` }, { status: 400 });
  }
  if (requestedAmount > remaining) {
    return NextResponse.json({ error: `Cannot pay more than the remaining balance of ₦${remaining.toLocaleString()}` }, { status: 400 });
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('paystack_subaccount_code')
    .eq('id', invoice.business_id)
    .maybeSingle();

  if (!business?.paystack_subaccount_code) {
    return NextResponse.json({ error: 'Online payments are not set up for this business yet' }, { status: 400 });
  }

  try {
    const tx = await initializeTransaction({
      email,
      amountKobo: Math.round(requestedAmount * 100),
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/inv/${invoiceId}`,
      metadata: { payment_type: 'invoice_installment', invoice_id: invoiceId },
      subaccountCode: business.paystack_subaccount_code,
    });
    return NextResponse.json({ authorization_url: tx.data.authorization_url });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Could not start payment' }, { status: 502 });
  }
}
