'use client';

import { useEffect, useState } from 'react';
import { csrfFetch } from '../../lib/csrfFetch';

// Talks to app/api/ai/insights/route.js — GET reads whatever's cached on
// the business (instant, no AI call), POST actually generates a fresh
// set and re-caches it. Kept as its own component (rather than inline in
// dashboard/page.js) since it manages its own loading/error/cache state
// independently of everything else on that page.
export default function AiInsights({ businessId }) {
  const [insights, setInsights] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [stale, setStale] = useState(true);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadCached(); }, [businessId]);

  async function loadCached() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/insights');
      const data = await res.json();
      setInsights(data.insights);
      setGeneratedAt(data.generatedAt);
      setStale(data.stale);
    } catch {
      // Silent — the dashboard's other numbers still load fine without
      // this section; the "Generate insights" button below just won't
      // have a cached starting point to show.
    }
    setLoading(false);
  }

  async function generate() {
    setGenerating(true);
    setError('');
    try {
      const res = await csrfFetch('/api/ai/insights', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not generate insights.');
      setInsights(data.insights);
      setGeneratedAt(data.generatedAt);
      setStale(false);
    } catch (err) {
      setError(err.message);
    }
    setGenerating(false);
  }

  if (loading) return null;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px', marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: insights ? 10 : 4 }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', margin: 0, fontSize: 15.5 }}>
          🧠 AI Business Insights
        </h3>
        {insights && (
          <button
            onClick={generate}
            disabled={generating}
            style={{
              background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6,
              padding: '5px 11px', fontSize: 11.5, fontWeight: 600, cursor: generating ? 'default' : 'pointer',
            }}
          >
            {generating ? 'Refreshing…' : stale ? 'Refresh' : 'Refresh anyway'}
          </button>
        )}
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, margin: '0 0 8px' }}>{error}</p>}

      {insights ? (
        <>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insights.map((item, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13.5, color: 'var(--text)' }}>
                <span style={{ flexShrink: 0 }}>{item.icon}</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
          {generatedAt && (
            <p style={{ fontSize: 10.5, color: 'var(--text-faint)', margin: '10px 0 0' }}>
              Generated {new Date(generatedAt).toLocaleString('en-NG')}{stale ? ' — based on slightly older data' : ''}
            </p>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Get a few AI-generated observations about your sales, stock, and customers — based on your own numbers, nothing invented.
          </p>
          <button
            onClick={generate}
            disabled={generating}
            style={{
              background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px',
              fontWeight: 700, fontSize: 12.5, cursor: generating ? 'default' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {generating ? 'Thinking…' : 'Generate insights'}
          </button>
        </div>
      )}
    </div>
  );
}
