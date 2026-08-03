import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../../lib/supabaseAdmin';

// Intentionally public — the customer signing this has no Supabase
// session, same as the /inv/[id] receipt page itself. Two things keep
// this from being a soft spot rather than a real vulnerability:
//   1. It never overwrites an existing signature (checked below) — so at
//      worst a stranger with the link can add a first signature, not
//      tamper with one that's already there.
//   2. A drawn signature carries no strong identity guarantee anyway, on
//      this or any similarly lightweight "sign on delivery" flow — the
//      value is a quick acknowledgement gesture, not legal proof.
export async function POST(request, { params }) {
  const { signature } = await request.json();

  if (!signature || typeof signature !== 'string' || !signature.startsWith('data:image/png;base64,')) {
    return NextResponse.json({ error: 'Invalid signature data' }, { status: 400 });
  }

  // A generous but real ceiling — a signature pad PNG this size would
  // already be a data-URL well over what a drawn line needs.
  if (signature.length > 300_000) {
    return NextResponse.json({ error: 'Signature image is too large' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, customer_signature_data')
    .eq('id', params.id)
    .single();

  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  if (invoice.customer_signature_data) {
    return NextResponse.json({ error: 'This receipt has already been signed' }, { status: 409 });
  }

  const { error } = await supabase
    .from('invoices')
    .update({ customer_signature_data: signature })
    .eq('id', params.id)
    .is('customer_signature_data', null); // belt-and-suspenders against a race between two signs

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
