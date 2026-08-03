'use client';

import { useState } from 'react';

const METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'bank_transfer', label: 'Bank transfer' },
  { id: 'card', label: 'Card / POS' },
  { id: 'other', label: 'Other' },
];

export default function MarkPaidModal({ invoice, onConfirm, onClose }) {
  const [method, setMethod] = useState('cash');
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    try {
      await onConfirm(method);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 340, width: '100%', borderTop: '5px solid var(--success)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, fontSize: 17 }}>
          Mark {invoice.invoice_number} as paid
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -6 }}>
          How was this paid? Shows on the receipt.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {METHODS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id)}
              style={{
                flex: '1 1 45%', padding: '9px 6px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${method === m.id ? 'var(--success)' : 'var(--border)'}`,
                background: method === m.id ? 'var(--success-bg)' : 'var(--bg)',
                color: method === m.id ? 'var(--success)' : 'var(--text-muted)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

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
