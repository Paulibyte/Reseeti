'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AnnouncementsManager({ announcements }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [targetPlan, setTargetPlan] = useState('all');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function create() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message, cta_label: ctaLabel, cta_url: ctaUrl, target_plan: targetPlan }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `Could not save (server said: ${res.status})`); return; }
      setTitle(''); setMessage(''); setCtaLabel(''); setCtaUrl(''); setTargetPlan('all');
      router.refresh();
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id, active) {
    setBusyId(id);
    await fetch(`/api/admin/announcements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    setBusyId(null);
    router.refresh();
  }

  async function remove(id) {
    if (!confirm('Delete this announcement permanently? This cannot be undone.')) return;
    setBusyId(id);
    await fetch(`/api/admin/announcements/${id}`, { method: 'DELETE' });
    setBusyId(null);
    router.refresh();
  }

  const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' };

  return (
    <div style={{ marginTop: 28 }}>
      <h2 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 17, margin: '0 0 4px' }}>
        Promotional announcements
      </h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Shown as a dismissible floating message on the dashboard. Only the most recent active one shows at a time; a person who dismisses it sees it again the next day.
      </p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, maxWidth: 460, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Title</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} placeholder="e.g. Save 20% this month" />

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="What's the offer?" />

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Button text (optional)</label>
        <input type="text" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} style={inputStyle} placeholder="e.g. Upgrade now" />

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Button link (optional)</label>
        <input type="text" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} style={inputStyle} placeholder="https://…" />

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Show to</label>
        <select value={targetPlan} onChange={(e) => setTargetPlan(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }}>
          <option value="all">Every business</option>
          <option value="free">Free plan only</option>
          <option value="pro">Pro plan only</option>
        </select>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}
        <button
          onClick={create}
          disabled={saving || !title.trim() || !message.trim()}
          style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
        >
          {saving ? 'Posting…' : 'Post announcement'}
        </button>
      </div>

      {announcements.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No announcements posted yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 620 }}>
          {announcements.map((a) => (
            <div key={a.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div>
                  <p style={{ margin: '0 0 3px', fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{a.title}</p>
                  <p style={{ margin: '0 0 3px', fontSize: 12.5, color: 'var(--text-muted)' }}>{a.message}</p>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase' }}>
                    {a.target_plan === 'all' ? 'Every business' : `${a.target_plan} plan only`}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => toggleActive(a.id, !a.active)}
                    disabled={busyId === a.id}
                    style={{
                      fontSize: 11, padding: '4px 10px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700,
                      background: a.active ? 'var(--success-bg)' : 'var(--orange-bg)',
                      color: a.active ? 'var(--success)' : 'var(--orange-dark)',
                    }}
                  >
                    {a.active ? 'ACTIVE' : 'OFF'}
                  </button>
                  <button
                    onClick={() => remove(a.id)}
                    disabled={busyId === a.id}
                    style={{ fontSize: 12, background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
