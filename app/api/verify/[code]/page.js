import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { computeReceiptSignature } from '../../../../lib/receiptSignature';

function money(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG');
}

// Deliberately minimal: this page exists so a stranger holding a printed
// or screenshotted receipt can confirm it's genuine without needing the
// full shareable invoice link — so it shows only what's needed for that
// (business name, invoice number, date, amount, paid status), not
// customer contact details or anything else that link would expose.
export default async function VerifyPage({ params }) {
  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, invoice_number, total, paid, created_at, business_id, verification_code')
    .eq('verification_code', params.code.toUpperCase())
    .maybeSingle();

  if (!invoice) {
    return (
      <Shell>
        <div style={{ fontSize: 40, marginBottom: 10 }}>❓</div>
        <p style={{ fontWeight: 700, color: 'var(--heading)', fontSize: 17, margin: '0 0 6px' }}>Code not recognized</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5, maxWidth: 320, margin: '0 auto' }}>
          This verification code doesn't match any receipt on record. Double-check it against the printed or shared copy.
        </p>
      </Shell>
    );
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('name')
    .eq('id', invoice.business_id)
    .single();

  const signature = computeReceiptSignature({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    businessId: invoice.business_id,
    total: invoice.total,
    createdAt: invoice.created_at,
  });

  return (
    <Shell>
      <div style={{ fontSize: 40, marginBottom: 6 }}>{invoice.paid ? '✅' : '📄'}</div>
      <p style={{ fontWeight: 700, color: 'var(--heading)', fontSize: 18, margin: '0 0 4px' }}>
        Genuine receipt
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 20px' }}>
        Verified against Reseeti's records
      </p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px', textAlign: 'left' }}>
        <Row label="Business" value={business?.name || 'Unknown'} />
        <Row label="Invoice" value={invoice.invoice_number} mono />
        <Row label="Date" value={new Date(invoice.created_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })} />
        <Row label="Amount" value={money(invoice.total)} bold />
        <Row
          label="Status"
          value={invoice.paid ? 'Paid' : 'Unpaid'}
          valueColor={invoice.paid ? 'var(--success)' : 'var(--danger)'}
        />
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
          <Row label="Security hash" value={signature} mono small />
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 16 }}>
        This hash is recomputed fresh from the stored invoice each time this page loads — it should match the one printed on the receipt.
      </p>
    </Shell>
  );
}

function Row({ label, value, mono, bold, small, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: small ? 11.5 : 13.5 }}>
      <span style={{ color: 'var(--text-faint)' }}>{label}</span>
      <span style={{
        fontFamily: mono ? 'monospace' : 'inherit',
        fontWeight: bold ? 700 : 500,
        color: valueColor || 'var(--text)',
      }}>
        {value}
      </span>
    </div>
  );
}

function Shell({ children }) {
  return (
    <main style={{ maxWidth: 420, margin: '60px auto', padding: '0 20px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
      {children}
    </main>
  );
}
