'use client';

import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { formatNaira } from '../../lib/format';

const VOID_REASONS = ['Wrong quantity', 'Wrong price', 'Wrong customer', 'Duplicate invoice', 'Customer cancelled', 'Other'];
const METHOD_LABELS = { cash: 'Cash', transfer: 'Bank transfer', pos: 'POS', card: 'Card', ussd: 'USSD', other: 'Other' };

// Voiding is done by the void_invoice() database function (Stage 59),
// not by updating the invoice from here: the function re-checks that
// the caller is an owner or manager, restocks the items, and writes the
// audit entry in one atomic step. This component only collects the
// reason and shows the function's own error messages, which are
// written to be shown to the user as-is.
//
// An invoice with recorded payments can't be voided until they're
// refunded, so those payments are listed right here with a Refund
// action — the owner never has to leave this dialog to unblock it.
export default function VoidInvoiceModal({ invoice, onClose, onVoided, onChanged }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [paidFlag, setPaidFlag] = useState(!!invoice.paid);
  const [reason, setReason] = useState(VOID_REASONS[0]);
  const [notes, setNotes] = useState('');
  const [refundingId, setRefundingId] = useState(null);
  const [refundReason, setRefundReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { reload(); }, []);

  // Re-reads from the database rather than trusting the row the list
  // was opened with: a refund resets the invoice's paid flag, and
  // another person may have recorded a payment since the list loaded.
  async function reload() {
    const [{ data: pays }, { data: inv }] = await Promise.all([
      supabase.from('invoice_payments').select('id, method, amount, created_at').eq('invoice_id', invoice.id).order('created_at'),
      supabase.from('invoices').select('paid, voided_at').eq('id', invoice.id).maybeSingle(),
    ]);
    setPayments(pays || []);
    setPaidFlag(!!inv?.paid);
    if (inv?.voided_at) setError('This invoice has already been voided.');
    setLoading(false);
  }

  const paidTotal = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const hasPayments = payments.length > 0;
  const blockedByFlagOnly = !hasPayments && paidFlag;
  const blocked = hasPayments || blockedByFlagOnly;

  async function refund(paymentId) {
    if (!refundReason.trim()) { setError('Enter a reason for this refund.'); return; }
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('refund_invoice_payment', { p_payment_id: paymentId, p_reason: refundReason.trim() });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setRefundingId(null);
    setRefundReason('');
    await reload();
    onChanged?.();
  }

  async function confirmVoid() {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('void_invoice', {
      p_invoice_id: invoice.id,
      p_reason: reason,
      p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onVoided();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 55 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 420, width: '100%', maxHeight: '90vh', overflowY: 'auto', borderTop: '5px solid var(--danger)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, marginBottom: 2 }}>Void invoice</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          {invoice.invoice_number} · {invoice.customer_name} · {formatNaira(invoice.total)}
        </p>

        {loading && <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>Checking this invoice…</p>}

        {!loading && hasPayments && (
          <div style={{ background: 'var(--orange-bg)', border: '1px solid var(--orange)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: 'var(--orange-dark)' }}>
              {formatNaira(paidTotal)} in payments is recorded on this invoice.
            </p>
            <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text)' }}>
              An invoice can't be voided while it holds payments. Refund them first — each refund is logged with your reason.
            </p>
            {payments.map((p) => (
              <div key={p.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>
                    <b>{formatNaira(p.amount)}</b> · {METHOD_LABELS[p.method] || p.method} · {new Date(p.created_at).toLocaleDateString('en-NG')}
                  </span>
                  {refundingId !== p.id && (
                    <button
                      onClick={() => { setRefundingId(p.id); setRefundReason(''); setError(''); }}
                      style={{ fontSize: 12, background: 'none', border: '1px solid var(--orange)', color: 'var(--orange-dark)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Refund
                    </button>
                  )}
                </div>
                {refundingId === p.id && (
                  <div style={{ marginTop: 8 }}>
                    <input
                      autoFocus
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      placeholder="Reason, e.g. Customer returned goods"
                      style={inputStyle}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        onClick={() => refund(p.id)}
                        disabled={busy}
                        style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 6, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}
                      >
                        {busy ? 'Refunding…' : `Confirm refund of ${formatNaira(p.amount)}`}
                      </button>
                      <button
                        onClick={() => { setRefundingId(null); setError(''); }}
                        style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 12px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '6px 0 0' }}>
                      This records that the money was handed back to the customer. Do the actual cash or transfer return yourself.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!loading && blockedByFlagOnly && (
          <div style={{ background: 'var(--orange-bg)', border: '1px solid var(--orange)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text)' }}>
              This invoice is marked as paid (it has no individual payment records — typical of older invoices).
              Close this, use the PAID button to mark it unpaid, then void it.
            </p>
          </div>
        )}

        {!loading && !blocked && (
          <>
            <label style={labelStyle}>Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle}>
              {VOID_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>

            <label style={labelStyle}>Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />

            <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '10px 0 0' }}>
              This can't be undone. The invoice stays in your records marked VOID, and the stock it used goes back on your shelves.
              Serialized units (phones, laptops) on it become available to sell again.
            </p>
          </>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {!blocked && !loading && (
            <button
              onClick={confirmVoid}
              disabled={busy}
              style={{ background: 'var(--danger)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
            >
              {busy ? 'Voiding…' : 'Void invoice'}
            </button>
          )}
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}
          >
            {blocked ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 10 };
const inputStyle = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
  boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
};
