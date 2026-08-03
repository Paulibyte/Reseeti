'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function toDateInputValue(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

export default function BusinessOverrideForm({ business, defaultLimit }) {
  const router = useRouter();
  const [plan, setPlan] = useState(business.plan);
  const [planRenewsAt, setPlanRenewsAt] = useState(toDateInputValue(business.plan_renews_at));
  const [useCustomLimit, setUseCustomLimit] = useState(business.monthly_invoice_limit != null);
  const [customLimit, setCustomLimit] = useState(business.monthly_invoice_limit ?? defaultLimit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/businesses/${business.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          plan_renews_at: plan === 'pro' && planRenewsAt ? new Date(planRenewsAt).toISOString() : null,
          monthly_invoice_limit: useCustomLimit ? Number(customLimit) : null,
        }),
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
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, maxWidth: 440 }}>
      <p style={{ margin: '0 0 14px', fontWeight: 700, color: 'var(--heading)', fontSize: 14 }}>Overrides</p>

      <label style={labelStyle}>Plan</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['free', 'pro'].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPlan(p)}
            style={{
              flex: 1, padding: '8px 6px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase',
              border: `1px solid ${plan === p ? 'var(--orange)' : 'var(--border)'}`,
              background: plan === p ? 'var(--orange-bg)' : 'var(--bg)',
              color: plan === p ? 'var(--orange-dark)' : 'var(--text-muted)',
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {plan === 'pro' && (
        <>
          <label style={labelStyle}>Renews on</label>
          <input
            type="date"
            value={planRenewsAt}
            onChange={(e) => setPlanRenewsAt(e.target.value)}
            style={inputStyle}
          />
        </>
      )}

      <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, marginTop: plan === 'pro' ? 4 : 0 }}>
        <input type="checkbox" checked={useCustomLimit} onChange={(e) => setUseCustomLimit(e.target.checked)} />
        Custom monthly invoice limit
      </label>
      {useCustomLimit ? (
        <input
          type="number"
          min={0}
          value={customLimit}
          onChange={(e) => setCustomLimit(e.target.value)}
          style={inputStyle}
        />
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 10px' }}>
          Using the platform default ({defaultLimit}/month) — only matters while this business is on Free.
        </p>
      )}

      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
      >
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
      </button>
    </div>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 };
const inputStyle = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
  marginBottom: 12, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
};
