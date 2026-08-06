'use client';

import { useState } from 'react';
import { formatNaira } from '../../lib/format';

const METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'pos', label: 'POS' },
  { id: 'card', label: 'Card' },
  { id: 'ussd', label: 'USSD' },
  { id: 'other', label: 'Other' },
];

export function methodLabel(id) {
  return METHODS.find((m) => m.id === id)?.label || id;
}

// onConfirm receives an array of { method, amount } rows summing to the
// invoice total — a single-method payment is just an array of length 1.
export default function MarkPaidModal({ invoice, onConfirm, onClose }) {
  const [split, setSplit] = useState(false);
  const [method, setMethod] = useState('cash');
  // Split mode: a list of { method, amount } rows the person builds up.
  const [rows, setRows] = useState([{ method: 'cash', amount: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = Number(invoice.total) || 0;
  const rowsTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const remaining = total - rowsTotal;

  function updateRow(idx, field, value) {
    const next = [...rows];
    next[idx][field] = value;
    setRows(next);
  }

  function addRow() {
    setRows([...rows, { method: 'cash', amount: remaining > 0 ? remaining : '' }]);
  }

  function removeRow(idx) {
    setRows(rows.filter((_, i) => i !== idx));
  }

  async function confirm() {
    setError('');
    let payments;
    if (split) {
      const cleaned = rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: Number(r.amount) }));
      if (cleaned.length === 0) {
        setError('Add at least one payment.');
        return;
      }
      const sum = cleaned.reduce((s, r) => s + r.amount, 0);
      // Exact match required — this is meant to record how the total was
      // actually made up, not to handle change/tender, so a mismatch
      // almost always means a typo in one of the rows.
      if (Math.abs(sum - total) > 0.5) {
        setError(`Payments add up to ${formatNaira(sum)}, but the invoice total is ${formatNaira(total)}.`);
        return;
      }
      payments = cleaned;
    } else {
      payments = [{ method, amount: total }];
    }

    setSaving(true);
    await onConfirm(payments);
    setSaving(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 380, width: '100%', borderTop: '5px solid var(--success)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, fontSize: 17 }}>
          Mark {invoice.invoice_number} as paid
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -6 }}>
          Total due: <strong>{formatNaira(total)}</strong>. How was this paid?
        </p>

        {!split && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                style={{
                  flex: '1 1 28%', padding: '9px 6px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${method === m.id ? 'var(--success)' : 'var(--border)'}`,
                  background: method === m.id ? 'var(--success-bg)' : 'var(--bg)',
                  color: method === m.id ? 'var(--success)' : 'var(--text-muted)',
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {split && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            {rows.map((row, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  value={row.method}
                  onChange={(e) => updateRow(idx, 'method', e.target.value)}
                  style={{ flex: '1 1 auto', padding: '8px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}
                >
                  {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <input
                  type="number"
                  min="0"
                  placeholder="Amount"
                  value={row.amount}
                  onChange={(e) => updateRow(idx, 'amount', e.target.value)}
                  style={{ width: 100, padding: '8px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}
                />
                {rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(idx)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>×</button>
                )}
              </div>
            ))}
            <button type="button" onClick={addRow} style={{ background: 'none', border: '1px dashed var(--border)', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', color: 'var(--text)', fontSize: 12.5 }}>
              + Add another payment method
            </button>
            <p style={{ fontSize: 12.5, color: remaining === 0 ? 'var(--success)' : 'var(--text-muted)', margin: '2px 0 0' }}>
              {remaining > 0 ? `${formatNaira(remaining)} remaining` : remaining < 0 ? `${formatNaira(-remaining)} over the total` : 'Fully accounted for ✓'}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => { setSplit(!split); setError(''); }}
          style={{ background: 'none', border: 'none', color: 'var(--orange)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 16, textDecoration: 'underline' }}
        >
          {split ? 'Use a single payment method instead' : 'Split across multiple payment methods'}
        </button>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={confirm}
            disabled={saving}
            style={{ background: 'var(--success)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
          >
            {saving ? 'Saving…' : 'Confirm paid'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
