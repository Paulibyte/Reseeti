'use client';

import { useState } from 'react';
import { createClient } from '../../../../lib/supabaseClient';
import { formatNaira } from '../../../../lib/format';

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'pos', label: 'POS' },
  { value: 'card', label: 'Card' },
  { value: 'ussd', label: 'USSD' },
  { value: 'other', label: 'Other' },
];

// Inserts directly into invoice_payments — Stage 31's trigger
// (settle_invoice_from_payments) is what automatically flips the
// invoice to paid once the running total of these reaches its total, so
// this form never needs to touch invoices.paid itself, whether this
// payment clears the balance completely or leaves some still owing.
export default function RecordPaymentModal({ invoice, alreadyPaid, onClose, onRecorded }) {
  const supabase = createClient();
  const remaining = Number(invoice.total) - Number(alreadyPaid || 0);
  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : '');
  const [method, setMethod] = useState('cash');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const n = Number(amount);
    if (!n || n <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    setSaving(true);
    setError('');

    const { error: err } = await supabase
      .from('invoice_payments')
      .insert({ invoice_id: invoice.id, method, amount: n });

    setSaving(false);
    if (err) {
      setError(err.message || 'Could not record this payment.');
      return;
    }
    onRecorded();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 55 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 360, width: '100%', borderTop: '5px solid var(--orange)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, marginBottom: 2 }}>
          Record a payment
        </h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          {invoice.invoice_number} · {formatNaira(remaining)} still owing
          {Number(alreadyPaid) > 0 ? ` (${formatNaira(alreadyPaid)} already paid)` : ''}
        </p>
        <form onSubmit={submit}>
          <label style={labelStyle}>Amount received</label>
          <input required type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: -6, marginBottom: 4 }}>
            Enter less than the full amount for a partial payment — the invoice stays unpaid with the remaining balance shown until it's fully settled.
          </p>

          <label style={labelStyle}>Payment method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)} style={inputStyle}>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 10 };
const inputStyle = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
  boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
};
