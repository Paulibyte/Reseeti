'use client';

import { useState } from 'react';
import { resolveEditConflict } from '../../lib/offlineQueue';

const TABLE_LABELS = { products: 'product', customers: 'customer' };

// Shown when syncEdits (lib/offlineQueue.js) finds that a queued offline
// edit conflicts with a change another device made to the same record
// in the meantime — see that file's syncEdits for the detection logic.
// This is the resolution half: for each conflict, show what THIS device
// tried to change and let the person pick "keep my change" (apply it
// anyway, on top of the other device's edit) or "discard my change"
// (drop it, keeping whatever the other device left).
//
// Deliberately record-level, not field-level — showing "your price: 500
// vs the field that's actually different" would need diffing every
// field of every conflicting row, which is real complexity for a
// business that will realistically hit this rarely (it only happens
// when the SAME record is edited on two devices while at least one was
// offline). Keeping it simple here was the right tradeoff for how often
// it matters.
export default function SyncConflictModal({ supabase, conflicts, onResolved, onClose }) {
  const [resolving, setResolving] = useState(null);
  const [error, setError] = useState('');

  async function resolve(localId, resolution) {
    setResolving(localId);
    setError('');
    const result = await resolveEditConflict(supabase, localId, resolution);
    setResolving(null);
    if (!result.ok) {
      setError(result.error || 'Could not resolve that conflict — try again.');
      return;
    }
    onResolved();
  }

  if (conflicts.length === 0) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 460, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>
          Sync conflicts ({conflicts.length})
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -6 }}>
          An edit made on this device while offline conflicts with a change made on another device to the same
          record. Choose which change to keep for each.
        </p>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

        {conflicts.map((c) => (
          <div key={c.localId} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
            <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text)', fontSize: 13.5 }}>
              {TABLE_LABELS[c.table] || c.table}
              {c.conflictDetails?.rowDeleted && (
                <span style={{ color: 'var(--danger)', fontWeight: 600 }}> — this record was deleted elsewhere</span>
              )}
            </p>
            <div style={{ background: 'var(--surface-alt)', borderRadius: 6, padding: 10, fontSize: 12, marginBottom: 10 }}>
              {Object.entries(c.changes).map(([field, value]) => (
                <div key={field}>
                  <strong style={{ color: 'var(--text-muted)' }}>{field}:</strong>{' '}
                  <span style={{ color: 'var(--text)' }}>{String(value ?? '—')}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '0 0 10px' }}>
              That's what this device tried to change. The version on the server now is different — probably from
              another device.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => resolve(c.localId, 'keep_mine')}
                disabled={resolving === c.localId || c.conflictDetails?.rowDeleted}
                style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', opacity: c.conflictDetails?.rowDeleted ? 0.5 : 1 }}
              >
                {resolving === c.localId ? 'Applying…' : 'Keep my change'}
              </button>
              <button
                onClick={() => resolve(c.localId, 'discard_mine')}
                disabled={resolving === c.localId}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
              >
                Discard my change
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={onClose}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', width: '100%', marginTop: 4 }}
        >
          Resolve later
        </button>
      </div>
    </div>
  );
}
