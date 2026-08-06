'use client';

import { useEffect, useState } from 'react';
import { createClient } from '../../../lib/supabaseClient';

const REASON_LABELS = {
  sale: 'Sale',
  restock: 'Restock',
  adjustment: 'Adjustment',
  correction: 'Correction',
};

// memberNames: map of user_id -> display name, built once on the
// Inventory page from business_members (see inventory/page.js) and
// passed down rather than re-fetched per product, since opening
// history for several products in a session shouldn't mean refetching
// the same team roster each time.
export default function StockHistoryModal({ product, memberNames, onClose }) {
  const supabase = createClient();
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('stock_movements')
        .select('id, change_qty, reason, note, resulting_stock_qty, performed_by, created_at')
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(100);
      setMovements(data || []);
      setLoading(false);
    })();
  }, [product.id]);

  function who(userId) {
    if (!userId) return 'System';
    return memberNames?.[userId] || 'A team member';
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 55 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 460, width: '100%', borderTop: '5px solid var(--orange)', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, marginBottom: 2 }}>
          Stock history — {product.name}{product.unit_value ? ` (${product.unit_value}${product.unit || ''})` : ''}
        </h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          Currently {product.stock_qty} in stock.
        </p>

        <div style={{ overflowY: 'auto', flex: 1, marginBottom: 14 }}>
          {loading && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Loading…</p>}
          {!loading && movements.length === 0 && (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No stock changes recorded yet.</p>
          )}
          {movements.map((m, idx) => {
            const isOut = Number(m.change_qty) < 0;
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 2px',
                  borderBottom: idx === movements.length - 1 ? 'none' : '1px solid var(--border)',
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
                    {REASON_LABELS[m.reason] || m.reason}
                    {m.reason === 'sale' ? '' : ` — ${who(m.performed_by)}`}
                  </p>
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-faint)' }}>
                    {new Date(m.created_at).toLocaleString()}
                    {m.note ? ` · ${m.note}` : ''}
                  </p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: isOut ? 'var(--danger)' : 'var(--success)' }}>
                    {isOut ? '' : '+'}{m.change_qty}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)' }}>→ {m.resulting_stock_qty}</p>
                </div>
              </div>
            );
          })}
        </div>

        <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer', alignSelf: 'flex-start' }}>
          Close
        </button>
      </div>
    </div>
  );
}
