import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { initializeTransaction } from '../../../../lib/paystack';

const MIN_PAYMENT = 1000;

// Deliberately public — a parent paying a school fee has no Reseeti
// account and no session, the same way the WhatsApp catalogue checkout
// is public. Every number that actually matters (remaining balance,
// the minimum) is computed and enforced here, server-side, from the
// real invoice_payments already recorded — the amount the client sends
// is only ever a request, never trusted as fact.
export async function POST(req) {
  const { invoiceId, amount, email } = await req.json().catch(() => ({}));

  if (!invoiceId || !amount || !email) {
    return NextResponse.json({ error: 'Missing invoiceId, amount, or email' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, total, business_id, student_id, invoice_payments(amount)')
    .eq('id', invoiceId)
    .maybeSingle();

  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  // Scoped to school-fee invoices only, as decided — a plain sale
  // invoice (no student_id) can't be paid this way, regardless of
  // whether the business has online payments set up for other reasons
  // (e.g. the WhatsApp catalogue).
  if (!invoice.student_id) {
    return NextResponse.json({ error: 'This invoice is not eligible for online installment payment' }, { status: 400 });
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
    return NextResponse.json({ error: 'Online payments are not set up for this school yet' }, { status: 400 });
  }

  try {
    const tx = await initializeTransaction({
      email,
      amountKobo: Math.round(requestedAmount * 100),
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/inv/${invoiceId}`,
      metadata: { payment_type: 'school_fee_installment', invoice_id: invoiceId },
      subaccountCode: business.paystack_subaccount_code,
    });
    return NextResponse.json({ authorization_url: tx.data.authorization_url });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Could not start payment' }, { status: 502 });
  }
}
