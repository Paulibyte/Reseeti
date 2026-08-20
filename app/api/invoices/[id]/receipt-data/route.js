import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../../lib/supabaseAdmin';
import { computeReceiptSignature } from '../../../../../lib/receiptSignature';

// Deliberately public — same as the page it was extracted from
// (app/inv/[id]/page.js used to do this fetch during server rendering).
// Moved here so /inv/[id] can become a client component that fetches its
// own data instead of requiring Next.js's server to run on every single
// visit — the actual reason offline access was structurally impossible
// before this. The signing secret still never reaches the browser: it's
// used here, server-side, exactly as before, just returned as a
// pre-computed value in the JSON response instead of being embedded
// during SSR.
export async function GET(request, { params }) {
  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, customer_id, customer_name, customer_phone, subtotal, discount, loyalty_discount_applied, loyalty_discount_amount, service_charge_rate, service_charge_amount, vat_rate, vat_amount, shipping_fee, withholding_tax_rate, withholding_tax_amount, total, paid, payment_method, verification_code, estimated_delivery_date, due_date, customer_signature_data, created_at, business_id, invoice_items(id, description, qty, price, sort_order), invoice_payments(method, amount), customers(email)')
    .eq('id', params.id)
    .order('sort_order', { foreignTable: 'invoice_items' })
    .single();

  if (!invoice) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('name, phone, address, logo_url, signature_url, bank_name, bank_account_name, bank_account_number, terms_and_conditions')
    .eq('id', invoice.business_id)
    .single();

  const signature = computeReceiptSignature({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    businessId: invoice.business_id,
    total: invoice.total,
    createdAt: invoice.created_at,
  });

  return NextResponse.json({ invoice, business, signature });
}
