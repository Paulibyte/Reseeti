'use client';

import { useState } from 'react';
import { createClient } from '../../../lib/supabaseClient';

const REASONS = [
  { value: 'restock', label: 'Restock (new stock received)' },
  { value: 'correction', label: 'Correction (fix a counting error)' },
  { value: 'adjustment', label: 'Other adjustment (damage, loss, etc.)' },
];

// Direction is chosen separately from the reason — a restock is always
// an increase, but a correction or adjustment can go either way (found
// extra stock during a count vs. writing off damaged/expired items) —
// so this form asks for direction and magnitude, then sends a single
// signed change_qty to the RPC.
export default function StockAdjustModal({ product, onClose, onAdjusted }) {
  const supabase = createClient();
  const [reason, setReason] = useState('restock');
  const [direction, setDirection] = useState('add');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const n = Number(qty);
    if (!n || n <= 0) {
      setError('Enter a quantity greater than 0.');
      return;
    }
    setSaving(true);
    setError('');

    const { data: newStock, error: err } = await supabase.rpc('log_manual_stock_movement', {
      p_product_id: product.id,
      p_change_qty: direction === 'add' ? n : -n,
      p_reason: reason,
      p_note: note || null,
    });

    setSaving(false);
    if (err) {
      setError(err.message || 'Could not update stock.');
      return;
    }
    onAdjusted(newStock);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 55 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 380, width: '100%', borderTop: '5px solid var(--orange)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, marginBottom: 2 }}>
          Adjust stock — {product.name}{product.unit_value ? ` (${product.unit_value}${product.unit || ''})` : ''}
        </h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          Currently {product.stock_qty} in stock. This change is logged with your name and the date.
        </p>
        <form onSubmit={submit}>
          <label style={labelStyle}>Reason</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle}>
            {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Direction</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value)} style={inputStyle}>
                <option value="add">Add to stock (+)</option>
                <option value="remove">Remove from stock (−)</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Quantity</label>
              <input required type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <label style={labelStyle}>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} placeholder="e.g. Delivery from supplier, or which shelf was miscounted" />

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
