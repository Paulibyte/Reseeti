'use client';

import { useRef, useState } from 'react';
import { formatNaira } from '../../lib/format';
import { renderElementToPDFBlob } from '../../lib/generateInvoicePDF';
import PrintReceiptButton from '../components/PrintReceiptButton';

// Deliberately a separate, self-contained component rather than reusing
// ReceiptClient.jsx — that component assumes a real, synced invoice
// (a real id for the share link/signature-save/email endpoints, a real
// invoice_number, a verification_code). A queued draft has none of
// those yet. Building a second, simpler layout here means zero risk of
// touching the already-working real receipt page while adding this.
//
// What IS reused, exactly as-is: renderElementToPDFBlob (PDF download)
// and PrintReceiptButton (Bluetooth/USB thermal printing) — both are
// already fully client-side with no network dependency at all, which is
// exactly why they can work here, mid-outage, on data that only exists
// on this device so far.
export default function OfflineDraftReceipt({ entry, business, onClose }) {
  const receiptRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  const items = entry.items || [];

  async function downloadPDF() {
    setDownloading(true);
    try {
      const blob = await renderElementToPDFBlob(receiptRef.current);
      const url = URL.createObjectURL(blob);
      // Same fix as the real receipt page and Reports — opens in a new
      // tab rather than forcing an automatic download, which mobile
      // Safari and some desktop configurations can silently block.
      window.open(url, '_blank');
    } finally {
      setDownloading(false);
    }
  }

  // A plain, invoice-shaped object with only the fields PrintReceiptButton
  // and buildReceiptBytes actually need for formatting — invoice_number
  // is a placeholder since a real one isn't assigned until this syncs to
  // the server, and paid/payment_method aren't set yet either (nothing
  // is marked paid until the seller does that from the real invoice
  // after syncing).
  const printableInvoice = {
    invoice_number: 'PENDING SYNC',
    customer_name: entry.customer_name,
    customer_phone: entry.customer_phone,
    total: entry.total,
    subtotal: entry.subtotal,
    discount: entry.discount,
    created_at: entry.createdAt,
    paid: false,
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 60, overflowY: 'auto' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, maxWidth: 420, width: '100%', margin: '20px 0' }}>
        <div style={{ background: 'var(--orange-bg)', color: 'var(--orange-dark)', textAlign: 'center', padding: '10px 16px', fontSize: 12.5, fontWeight: 700, borderRadius: '10px 10px 0 0' }}>
          Pending sync — this sale hasn&apos;t reached the server yet. It'll sync automatically once you&apos;re back online.
        </div>

        <div ref={receiptRef} style={{ padding: 24, background: 'var(--surface)' }}>
          {business?.logo_url && (
            <img src={business.logo_url} alt="" style={{ height: 40, marginBottom: 10, objectFit: 'contain' }} />
          )}
          <h2 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', margin: '0 0 2px', fontSize: 18 }}>
            {business?.name}
          </h2>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '0 0 14px' }}>
            {new Date(entry.createdAt).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>

          <div style={{ fontSize: 13, marginBottom: 14 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{entry.customer_name || 'Walk-in customer'}</p>
            {entry.customer_phone && <p style={{ margin: 0, color: 'var(--text-faint)' }}>{entry.customer_phone}</p>}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-faint)', fontSize: 10.5, textTransform: 'uppercase' }}>
                <th style={{ padding: '0 0 6px' }}>Description</th>
                <th style={{ padding: '0 0 6px', textAlign: 'center' }}>Qty</th>
                <th style={{ padding: '0 0 6px', textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ borderBottom: '1px dashed var(--border)' }}>
                  <td style={{ padding: '6px 0' }}>{it.description}</td>
                  <td style={{ padding: '6px 0', textAlign: 'center' }}>{it.qty}</td>
                  <td style={{ padding: '6px 0', textAlign: 'right' }}>{formatNaira(it.price * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: 13, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
            <span>Subtotal</span><span>{formatNaira(entry.subtotal)}</span>
          </div>
          {entry.discount > 0 && (
            <div style={{ fontSize: 13, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>Discount</span><span>- {formatNaira(entry.discount)}</span>
            </div>
          )}
          <div style={{ borderTop: '2px solid var(--heading)', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 16, color: 'var(--heading)' }}>
            <span>Total</span><span>{formatNaira(entry.total)}</span>
          </div>

          <p style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 18, marginBottom: 0 }}>
            This is a provisional receipt generated offline. Once synced, the official record is available at your
            shared invoice link.
          </p>
        </div>

        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={downloadPDF}
            disabled={downloading}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '11px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
          >
            {downloading ? 'Preparing…' : '⬇ Download PDF'}
          </button>
          <PrintReceiptButton business={business} invoice={printableInvoice} items={items} />
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '11px', borderRadius: 6, cursor: 'pointer' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
