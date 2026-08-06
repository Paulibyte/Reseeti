'use client';

import { useEffect, useState } from 'react';
import { listParkedSales, resumeParkedSale, discardParkedSale } from '../../lib/parkedSales';
import { formatNaira } from '../../lib/format';

function roughTotal(items) {
  return (items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
}

export default function ParkedSalesPanel({ onClose, onResume, onChanged }) {
  const [parked, setParked] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setParked(await listParkedSales());
    setLoading(false);
  }

  async function handleResume(id) {
    const entry = await resumeParkedSale(id);
    if (!entry) return;
    onChanged?.();
    onResume(entry.draft);
  }

  async function handleDiscard(id) {
    if (!confirm('Discard this parked sale? This cannot be undone.')) return;
    await discardParkedSale(id);
    onChanged?.();
    refresh();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 440, width: '100%', borderTop: '5px solid var(--orange)', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, marginBottom: 2 }}>Parked sales</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          Sales set aside while a customer wasn't ready to pay. Resume to pick up where you left off, or discard if it fell through.
        </p>

        <div style={{ overflowY: 'auto', flex: 1, marginBottom: 14 }}>
          {loading && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Loading…</p>}
          {!loading && parked.length === 0 && (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No parked sales right now.</p>
          )}
          {parked.map((p, idx) => (
            <div
              key={p.id}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '11px 2px',
                borderBottom: idx === parked.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{p.label}</p>
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-faint)' }}>
                  {(p.draft.items || []).filter((it) => it.description).length} item{(p.draft.items || []).length === 1 ? '' : 's'} · {formatNaira(roughTotal(p.draft.items))} ·{' '}
                  parked {new Date(p.parkedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => handleResume(p.id)}
                  style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
                >
                  Resume
                </button>
                <button
                  onClick={() => handleDiscard(p.id)}
                  style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '7px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                >
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer', alignSelf: 'flex-start' }}>
          Close
        </button>
      </div>
    </div>
  );
}
