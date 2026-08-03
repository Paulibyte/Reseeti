'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SettingsForm({ settings }) {
  const router = useRouter();
  const [limit, setLimit] = useState(settings?.free_plan_invoice_limit ?? 5);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ free_plan_invoice_limit: Number(limit) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `Could not save (server said: ${res.status})`); return; }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, maxWidth: 420 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
        Free plan monthly invoice limit
      </label>
      <input
        type="number"
        min={0}
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 6, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
      />
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 14px' }}>
        Applies to every business on the Free plan, except ones with their own custom limit set individually.
      </p>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  );
}
