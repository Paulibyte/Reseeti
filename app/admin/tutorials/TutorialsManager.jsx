'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { csrfFetch } from '../../../lib/csrfFetch';

export default function TutorialsManager({ tutorials }) {
  const router = useRouter();
  const [type, setType] = useState('doc');
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function create() {
    setSaving(true);
    setError('');
    try {
      const res = await csrfFetch('/api/admin/tutorials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, category, title, content, youtube_url: youtubeUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `Could not save (server said: ${res.status})`); return; }
      setCategory(''); setTitle(''); setContent(''); setYoutubeUrl('');
      router.refresh();
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id, active) {
    setBusyId(id);
    await csrfFetch(`/api/admin/tutorials/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    setBusyId(null);
    router.refresh();
  }

  async function remove(id) {
    if (!confirm('Delete this tutorial permanently? This cannot be undone.')) return;
    setBusyId(id);
    await csrfFetch(`/api/admin/tutorials/${id}`, { method: 'DELETE' });
    setBusyId(null);
    router.refresh();
  }

  const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' };

  // Grouped by category purely for display below the form — the form
  // itself doesn't need this, only the existing-tutorials list does.
  const byCategory = {};
  for (const t of tutorials) {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 6px' }}>
        Help tutorials
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>
        Documents and video tutorials shown on the public Help page, grouped by category.
      </p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, maxWidth: 480, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setType('doc')}
            style={{ flex: 1, padding: '8px', borderRadius: 6, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', border: `1px solid ${type === 'doc' ? 'var(--orange)' : 'var(--border)'}`, background: type === 'doc' ? 'var(--orange-bg)' : 'var(--bg)', color: type === 'doc' ? 'var(--orange-dark)' : 'var(--text-muted)' }}
          >
            📄 Document
          </button>
          <button
            type="button"
            onClick={() => setType('video')}
            style={{ flex: 1, padding: '8px', borderRadius: 6, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', border: `1px solid ${type === 'video' ? 'var(--orange)' : 'var(--border)'}`, background: type === 'video' ? 'var(--orange-bg)' : 'var(--bg)', color: type === 'video' ? 'var(--orange-dark)' : 'var(--text-muted)' }}
          >
            🎥 Video
          </button>
        </div>

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Category</label>
        <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} placeholder="e.g. Getting Started, Invoicing, School Billing" />

        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Title</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} placeholder="e.g. How to set up recurring invoices" />

        {type === 'doc' ? (
          <>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              Content — supports "# Heading", "## Smaller heading", "- bullet points", and "[link text](https://...)"
            </label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12.5 }} placeholder={'# Setting up recurring invoices\n\nGo to Recurring Invoices and click "New".\n\n- Choose how often it repeats\n- Set the first invoice date\n\nSee also [Invoice Fields](/help#custom-fields).'} />
          </>
        ) : (
          <>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>YouTube URL</label>
            <input type="text" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} style={inputStyle} placeholder="https://www.youtube.com/watch?v=…" />
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Short description (optional)</label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="One or two lines shown above the video" />
          </>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}
        <button
          onClick={create}
          disabled={saving || !category.trim() || !title.trim() || (type === 'doc' ? !content.trim() : !youtubeUrl.trim())}
          style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
        >
          {saving ? 'Posting…' : 'Post tutorial'}
        </button>
      </div>

      {Object.keys(byCategory).length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No tutorials posted yet.</p>
      ) : (
        Object.entries(byCategory).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', margin: '0 0 8px' }}>{cat}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 620 }}>
              {items.map((t) => (
                <div key={t.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
                      {t.type === 'video' ? '🎥' : '📄'} {t.title}
                    </p>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => toggleActive(t.id, !t.active)}
                        disabled={busyId === t.id}
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700, background: t.active ? 'var(--success-bg)' : 'var(--orange-bg)', color: t.active ? 'var(--success)' : 'var(--orange-dark)' }}
                      >
                        {t.active ? 'ACTIVE' : 'OFF'}
                      </button>
                      <button
                        onClick={() => remove(t.id)}
                        disabled={busyId === t.id}
                        style={{ fontSize: 12, background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '4px 9px', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
