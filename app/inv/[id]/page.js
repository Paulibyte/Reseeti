import { createAdminClient } from '../../../lib/supabaseAdmin';
import { computeReceiptSignature } from '../../../lib/receiptSignature';
import ReceiptClient from './ReceiptClient';

// This page is intentionally public — no login required. It's what a
// customer sees when a business shares an invoice link via WhatsApp.
// It uses the admin client (service role) rather than the normal RLS-bound
// client because the visitor has no Supabase session at all; we deliberately
// select only the columns safe to show a stranger (never email, plan,
// Paystack codes, etc).
export default async function PublicInvoicePage({ params }) {
  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, customer_id, customer_name, customer_phone, subtotal, discount, loyalty_discount_applied, loyalty_discount_amount, service_charge_rate, service_charge_amount, vat_rate, vat_amount, shipping_fee, withholding_tax_rate, withholding_tax_amount, total, paid, payment_method, verification_code, estimated_delivery_date, customer_signature_data, created_at, business_id, invoice_items(id, description, qty, price, sort_order), invoice_payments(method, amount), customers(email)')
    .eq('id', params.id)
    .order('sort_order', { foreignTable: 'invoice_items' })
    .single();

  if (!invoice) {
    return (
      <main style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center', padding: '0 20px', fontFamily: 'sans-serif' }}>
        <p style={{ color: 'var(--text-muted)' }}>This invoice link doesn't exist or may have been removed.</p>
      </main>
    );
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('name, phone, address, logo_url, signature_url, bank_name, bank_account_name, bank_account_number, terms_and_conditions')
    .eq('id', invoice.business_id)
    .single();

  // Computed server-side so the signing secret never reaches the browser
  // bundle — see lib/receiptSignature.js.
  const signature = computeReceiptSignature({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    businessId: invoice.business_id,
    total: invoice.total,
    createdAt: invoice.created_at,
  });

  return <ReceiptClient invoice={invoice} business={business} signature={signature} />;
}
