'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminsManager({ admins, myUserId }) {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [error, setError] = useState('');

  async function addAdmin(e) {
    e.preventDefault();
    setAdding(true);
    setError('');
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId.trim(), label: label.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `Could not add admin (server said: ${res.status})`); return; }
      setUserId('');
      setLabel('');
      router.refresh();
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setAdding(false);
    }
  }

  async function removeAdmin(id) {
    if (!confirm('Remove this person\'s admin access?')) return;
    setRemovingId(id);
    setError('');
    try {
      const res = await fetch(`/api/admin/admins/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `Could not remove admin (server said: ${res.status})`); return; }
      router.refresh();
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20, maxWidth: 560 }}>
        {admins.map((a) => (
          <div key={a.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 13.5, color: 'var(--text)' }}>
                {a.label || 'Unnamed admin'} {a.user_id === myUserId && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(you)</span>}
              </p>
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-faint)' }}>{[a.phone, a.email].filter(Boolean).join(' · ') || a.user_id}</p>
            </div>
            <button
              onClick={() => removeAdmin(a.user_id)}
              disabled={removingId === a.user_id}
              style={{ background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              {removingId === a.user_id ? 'Removing…' : 'Remove'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, maxWidth: 440 }}>
        <p style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--heading)', fontSize: 14 }}>Add an admin</p>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 12px' }}>
          They need to have signed in to Reseeti at least once already. Find their User UID in the Supabase dashboard under Authentication → Users.
        </p>
        <form onSubmit={addAdmin}>
          <input
            placeholder="User UID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            placeholder="Label (optional, e.g. their name)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={inputStyle}
          />
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
          <button
            type="submit"
            disabled={adding}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
          >
            {adding ? 'Adding…' : 'Add admin'}
          </button>
        </form>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
  marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
};
