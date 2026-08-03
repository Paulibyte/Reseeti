'use client';

import { useEffect, useRef, useState } from 'react';

import { formatNaira, formatRate } from '../../../lib/format';
import { renderElementToPDFBlob, blobToBase64 } from '../../../lib/generateInvoicePDF';
import PrintReceiptButton from '../../components/PrintReceiptButton';

const PAYMENT_METHOD_LABELS = {
  cash: 'Cash',
  transfer: 'Transfer',
  pos: 'POS',
  card: 'Card',
  ussd: 'USSD',
  other: 'Other',
  // Legacy value from before Stage 15's method rename — kept so old
  // invoices still display correctly rather than showing the raw code.
  bank_transfer: 'Bank Transfer',
};

// A small drawable canvas for the customer to sign on delivery — not a
// legally-binding e-signature, just a quick acknowledgement gesture (see
// app/api/invoices/[id]/signature/route.js for the write-once rule behind
// it). Buttons carry data-html2canvas-ignore so they don't show up in a
// downloaded PDF of an as-yet-unsigned receipt.
function SignaturePad({ onSave }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawingRef.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1E3A5F';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    setHasDrawn(true);
  }

  function end() {
    drawingRef.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  async function save() {
    setSaving(true);
    setError('');
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const ok = await onSave(dataUrl);
    setSaving(false);
    if (!ok) setError('Could not save — try again.');
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={150}
        height={60}
        style={{ border: '1px dashed var(--border)', borderRadius: 4, touchAction: 'none', width: '100%', maxWidth: 150, background: '#fff', display: 'block' }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }} data-html2canvas-ignore="true">
        <button type="button" onClick={clear} style={{ fontSize: 10.5, background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}>
          Clear
        </button>
        <button type="button" onClick={save} disabled={!hasDrawn || saving} style={{ fontSize: 10.5, background: 'var(--heading)', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>
          {saving ? 'Saving…' : 'Save signature'}
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: 10.5, margin: '4px 0 0' }} data-html2canvas-ignore="true">{error}</p>}
    </div>
  );
}

export default function ReceiptClient({ invoice, business, signature }) {
  const receiptRef = useRef(null);
  const barcodeCanvasRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [bankQrDataUrl, setBankQrDataUrl] = useState('');
  const [customerSignature, setCustomerSignature] = useState(invoice.customer_signature_data || null);
  const [showEmailPanel, setShowEmailPanel] = useState(false);
  const [emailTo, setEmailTo] = useState(invoice.customers?.email || '');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState('');

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/inv/${invoice.id}` : '';
  const verifyPath = `/verify/${invoice.verification_code}`;
  const hasBankDetails = business?.bank_name && business?.bank_account_name && business?.bank_account_number;

  // QR linking back to this digital receipt — lets someone with only a
  // printed copy scan straight to the live version.
  useEffect(() => {
    if (!shareUrl) return;
    (async () => {
      const QRCode = (await import('qrcode')).default;
      const dataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, width: 130, color: { dark: '#1E3A5F', light: '#00000000' } });
      setQrDataUrl(dataUrl);
    })();
  }, [shareUrl]);

  // A second, separate QR for the bank transfer panel — encodes the
  // transfer details as plain text (not a Nigerian interbank QR-pay
  // standard, since none is integrated here — this is a convenience
  // scan-to-read, not scan-to-pay).
  useEffect(() => {
    if (invoice.paid || !hasBankDetails) return;
    (async () => {
      const QRCode = (await import('qrcode')).default;
      const payload = `Bank Transfer\nBank: ${business.bank_name}\nAccount Name: ${business.bank_account_name}\nAccount Number: ${business.bank_account_number}\nAmount: NGN ${Number(invoice.total).toLocaleString()}\nReference: ${invoice.invoice_number}`;
      const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 110, color: { dark: '#1E3A5F', light: '#00000000' } });
      setBankQrDataUrl(dataUrl);
    })();
  }, [invoice.paid, hasBankDetails, business, invoice.total, invoice.invoice_number]);

  // Barcode encoding the invoice number — mainly a familiar "this is a
  // real receipt" visual convention (like POS till receipts), not read by
  // anything in-app.
  useEffect(() => {
    (async () => {
      const JsBarcode = (await import('jsbarcode')).default;
      if (barcodeCanvasRef.current) {
        JsBarcode(barcodeCanvasRef.current, invoice.invoice_number, {
          format: 'CODE128', width: 1.3, height: 34, displayValue: false,
          background: 'transparent', lineColor: '#1E3A5F', margin: 0,
        });
      }
    })();
  }, [invoice.invoice_number]);

  async function saveCustomerSignature(dataUrl) {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: dataUrl }),
      });
      if (!res.ok) return false;
      setCustomerSignature(dataUrl);
      return true;
    } catch {
      return false;
    }
  }

  function notifyTransferSent() {
    const phone = (business?.phone || '').replace(/\D/g, '');
    const waPhone = phone ? (phone.startsWith('0') ? '234' + phone.slice(1) : phone) : '';
    const msg = `Hi, I've completed the bank transfer of ${formatNaira(invoice.total)} for invoice ${invoice.invoice_number}. Please confirm and mark it paid. Thanks!`;
    const url = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  }

  async function downloadPDF() {
    setDownloading(true);
    try {
      const blob = await renderElementToPDFBlob(receiptRef.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoice_number}-${(invoice.customer_name || 'invoice').replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  async function sendEmail() {
    if (!emailTo.trim() || !emailTo.includes('@')) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError('');
    setEmailSending(true);
    try {
      const blob = await renderElementToPDFBlob(receiptRef.current);
      const pdfBase64 = await blobToBase64(blob);
      const res = await fetch('/api/email/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          verificationCode: invoice.verification_code,
          to: emailTo.trim(),
          pdfBase64,
          shareUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEmailError(data.error || 'Could not send the email — please try again.');
        return;
      }
      setEmailSent(true);
    } catch {
      setEmailError('Could not send the email — check your connection and try again.');
    } finally {
      setEmailSending(false);
    }
  }

  function shareWhatsApp() {
    let msg = `*${business?.name || 'Invoice'}*\nInvoice ${invoice.invoice_number}\n\n`;
    invoice.invoice_items.forEach((it) => {
      msg += `${it.description} x${it.qty} — ${formatNaira(it.qty * it.price)}\n`;
    });
    msg += `\nTotal: ${formatNaira(invoice.total)}\n\nView, download or pay: ${shareUrl}`;
    const phone = (invoice.customer_phone || '').replace(/\D/g, '');
    const waPhone = phone ? (phone.startsWith('0') ? '234' + phone.slice(1) : phone) : '';
    const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  }

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '30px 16px 60px', fontFamily: 'Inter, sans-serif', background: 'var(--bg)', minHeight: '100vh' }}>
      <div
        ref={receiptRef}
        style={{
          position: 'relative',
          background: 'var(--surface)',
          padding: '34px 26px 30px',
          boxShadow: '0 10px 24px rgba(30,58,95,0.10)',
          overflow: 'hidden',
        }}
      >
        {/* Watermark — sits behind everything else on the receipt. */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
          <span style={{ fontSize: 40, fontWeight: 800, color: 'var(--heading)', opacity: 0.055, transform: 'rotate(-28deg)', whiteSpace: 'nowrap', fontFamily: 'var(--font-heading)' }}>
            {(business?.name || 'RESEETI').toUpperCase()}
          </span>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          {invoice.paid && (
            <div
              style={{
                position: 'absolute', top: -4, right: 0, width: 88, height: 88, borderRadius: '50%',
                border: '3px double var(--success)', color: 'var(--success)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15,
                transform: 'rotate(-14deg)', opacity: 0.88, textAlign: 'center', lineHeight: 1.1,
              }}
            >
              PAID
            </div>
          )}

          <div style={{ textAlign: 'center', marginBottom: 18, paddingBottom: 14, borderBottom: '2px dashed var(--border)' }}>
            {business?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.logo_url}
                alt=""
                crossOrigin="anonymous"
                style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, margin: '0 auto 8px' }}
              />
            )}
            <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 20, color: 'var(--heading)', margin: '0 0 4px' }}>
              {business?.name || 'Business'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              {[business?.phone, business?.address].filter(Boolean).join(' · ')}
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 12, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: 'var(--heading)' }}>{invoice.invoice_number}</span>
            <span>{new Date(invoice.created_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          </div>
          {invoice.estimated_delivery_date && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12 }}>
              Estimated delivery: {new Date(invoice.estimated_delivery_date).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          )}

          <div style={{ fontSize: 13, marginBottom: 16, marginTop: invoice.estimated_delivery_date ? 0 : 12 }}>
            <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-faint)', display: 'block' }}>Billed to</span>
            {invoice.customer_name}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase', color: 'var(--text-faint)', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>Description</th>
                <th style={{ textAlign: 'center', fontSize: 10.5, textTransform: 'uppercase', color: 'var(--text-faint)', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>Qty</th>
                <th style={{ textAlign: 'right', fontSize: 10.5, textTransform: 'uppercase', color: 'var(--text-faint)', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.invoice_items.map((it) => (
                <tr key={it.id}>
                  <td style={{ padding: '7px 0', fontSize: 13.5, borderBottom: '1px dotted var(--border)' }}>{it.description}</td>
                  <td style={{ padding: '7px 0', fontSize: 13.5, borderBottom: '1px dotted var(--border)', textAlign: 'center' }}>{it.qty}</td>
                  <td style={{ padding: '7px 0', fontSize: 13.5, borderBottom: '1px dotted var(--border)', textAlign: 'right' }}>{formatNaira(it.qty * it.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
              <span>Subtotal</span><span>{formatNaira(invoice.subtotal)}</span>
            </div>
            {invoice.discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
                <span>Discount</span><span>- {formatNaira(invoice.discount)}</span>
              </div>
            )}
            {invoice.loyalty_discount_applied && invoice.loyalty_discount_amount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--success)', padding: '4px 0' }}>
                <span>🎉 Loyalty discount</span><span>- {formatNaira(invoice.loyalty_discount_amount)}</span>
              </div>
            )}
            {invoice.service_charge_amount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
                <span>Service charge {invoice.service_charge_rate > 0 ? `(${formatRate(invoice.service_charge_rate)})` : ''}</span>
                <span>{formatNaira(invoice.service_charge_amount)}</span>
              </div>
            )}
            {invoice.vat_amount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
                <span>VAT {invoice.vat_rate > 0 ? `(${formatRate(invoice.vat_rate)})` : ''}</span>
                <span>{formatNaira(invoice.vat_amount)}</span>
              </div>
            )}
            {invoice.shipping_fee > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
                <span>Shipping</span><span>{formatNaira(invoice.shipping_fee)}</span>
              </div>
            )}
            {invoice.withholding_tax_amount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
                <span>Withholding tax {invoice.withholding_tax_rate > 0 ? `(${formatRate(invoice.withholding_tax_rate)})` : ''}</span>
                <span>- {formatNaira(invoice.withholding_tax_amount)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22, color: 'var(--heading)', borderTop: '2px solid var(--heading)', marginTop: 8, paddingTop: 10 }}>
              <span>Total</span><span>{formatNaira(invoice.total)}</span>
            </div>
            {invoice.paid && invoice.payment_method === 'split' && invoice.invoice_payments?.length > 0 && (
              <div style={{ textAlign: 'right', margin: '6px 0 0' }}>
                {invoice.invoice_payments.map((p, i) => (
                  <p key={i} style={{ fontSize: 11.5, color: 'var(--success)', margin: '2px 0', fontWeight: 600 }}>
                    {PAYMENT_METHOD_LABELS[p.method] || p.method}: {formatNaira(p.amount)}
                  </p>
                ))}
              </div>
            )}
            {invoice.paid && invoice.payment_method && invoice.payment_method !== 'split' && (
              <p style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--success)', margin: '4px 0 0', fontWeight: 600 }}>
                Paid via {PAYMENT_METHOD_LABELS[invoice.payment_method] || invoice.payment_method}
              </p>
            )}
          </div>

          {!invoice.paid && hasBankDetails && (
            <div style={{ marginTop: 18, padding: '14px 16px', background: 'var(--orange-bg)', border: '1px solid var(--orange)', borderRadius: 8 }}>
              <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 12.5, color: 'var(--orange-dark)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                Pay via bank transfer
              </p>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span style={{ color: 'var(--text-faint)' }}>Bank</span><span style={{ fontWeight: 600 }}>{business.bank_name}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span style={{ color: 'var(--text-faint)' }}>Account name</span><span style={{ fontWeight: 600 }}>{business.bank_account_name}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span style={{ color: 'var(--text-faint)' }}>Account number</span><span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{business.bank_account_number}</span></div>
                </div>
                {bankQrDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={bankQrDataUrl} alt="Bank transfer QR" style={{ width: 72, height: 72, flexShrink: 0 }} />
                )}
              </div>
              <button
                type="button"
                onClick={notifyTransferSent}
                data-html2canvas-ignore="true"
                style={{ marginTop: 10, width: '100%', background: 'var(--success)', color: '#fff', border: 'none', padding: '8px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                I've sent this — notify seller
              </button>
              <p style={{ fontSize: 10.5, color: 'var(--text-faint)', margin: '8px 0 0' }}>
                The seller will confirm the transfer on their end and mark this receipt Paid — it doesn't update automatically.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 20, paddingTop: 14, borderTop: '2px dashed var(--border)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)', fontFamily: 'monospace', lineHeight: 1.6 }}>
              <div>Verify: <a href={verifyPath} style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{invoice.verification_code}</a></div>
              {signature && <div>Hash: {signature}</div>}
              <canvas ref={barcodeCanvasRef} style={{ marginTop: 4 }} />
            </div>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="Scan to view receipt" style={{ width: 62, height: 62, flexShrink: 0 }} />
            )}
          </div>

          {business?.terms_and_conditions && (
            <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-faint)' }}>
              <p style={{ margin: '0 0 3px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, fontSize: 10 }}>Terms &amp; conditions</p>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{business.terms_and_conditions}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, marginTop: 22 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.3, margin: '0 0 6px' }}>Seller signature</p>
              {business?.signature_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={business.signature_url} alt="Seller signature" crossOrigin="anonymous" style={{ height: 40, maxWidth: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ height: 40, borderBottom: '1px solid var(--border)' }} />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.3, margin: '0 0 6px' }}>Customer signature</p>
              {customerSignature ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={customerSignature} alt="Customer signature" style={{ height: 40, maxWidth: '100%', objectFit: 'contain' }} />
              ) : (
                <SignaturePad onSave={saveCustomerSignature} />
              )}
            </div>
          </div>

          <div style={{ marginTop: 20, fontSize: 11.5, color: 'var(--text-faint)', textAlign: 'center', fontFamily: 'monospace' }}>
            Generated with Reseeti
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button
          onClick={downloadPDF}
          disabled={downloading}
          style={{ flex: 1, background: 'none', border: '1.5px solid var(--heading)', color: 'var(--heading)', padding: '11px', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}
        >
          {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
        <button
          onClick={shareWhatsApp}
          style={{ flex: 1, background: 'var(--success)', color: '#fff', border: 'none', padding: '11px', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}
        >
          Share on WhatsApp
        </button>
      </div>

      {/*
        Renders nothing on browsers without Web Bluetooth or Web Serial
        support (notably Safari/iOS) — see PrintReceiptButton.jsx.
      */}
      <div style={{ marginTop: 10 }}>
        <PrintReceiptButton business={business} invoice={invoice} items={invoice.invoice_items} />
      </div>

      <button
        onClick={() => { setShowEmailPanel(!showEmailPanel); setEmailError(''); }}
        style={{ width: '100%', marginTop: 10, background: 'none', border: '1.5px solid var(--border)', color: 'var(--text)', padding: '11px', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}
      >
        ✉ Email invoice
      </button>

      {showEmailPanel && (
        <div style={{ marginTop: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: 14 }}>
          {emailSent ? (
            <p style={{ margin: 0, color: 'var(--success)', fontSize: 13.5, fontWeight: 600 }}>
              ✓ Sent to {emailTo} with the invoice attached as a PDF.
            </p>
          ) : (
            <>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Send this invoice to
              </label>
              <input
                type="email"
                placeholder="customer@example.com"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 8, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
              />
              {emailError && <p style={{ color: 'var(--danger)', fontSize: 12.5, margin: '0 0 8px' }}>{emailError}</p>}
              <button
                onClick={sendEmail}
                disabled={emailSending}
                style={{ width: '100%', background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
              >
                {emailSending ? 'Sending…' : 'Send'}
              </button>
            </>
          )}
        </div>
      )}
    </main>
  );
}
