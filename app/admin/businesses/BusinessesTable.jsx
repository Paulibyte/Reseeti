'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function BusinessesTable({ rows, defaultLimit }) {
  const [query, setQuery] = useState('');

  const filtered = rows.filter((b) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [b.name, b.phone, b.email].some((v) => (v || '').toLowerCase().includes(q));
  });

  return (
    <div>
      <input
        placeholder="Search by name, phone, or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', maxWidth: 360, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13.5, marginBottom: 14, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' }}
      />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', padding: '10px 16px', background: 'var(--surface-alt)', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          <span style={{ flex: 2 }}>Business</span>
          <span style={{ flex: 1 }}>Plan</span>
          <span style={{ flex: 1 }}>Invoices this month</span>
          <span style={{ flex: 1 }}>Joined</span>
        </div>
        {filtered.length === 0 && (
          <p style={{ padding: '18px 16px', color: 'var(--text-faint)', fontSize: 13.5, margin: 0 }}>No businesses match "{query}".</p>
        )}
        {filtered.map((b) => (
          <Link
            key={b.id}
            href={`/admin/businesses/${b.id}`}
            style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}
          >
            <span style={{ flex: 2, minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 13.5, color: 'var(--text)' }}>{b.name}</p>
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-faint)' }}>{[b.phone, b.email].filter(Boolean).join(' · ')}</p>
            </span>
            <span style={{ flex: 1 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                color: b.plan === 'pro' ? 'var(--success)' : 'var(--text-muted)',
                background: b.plan === 'pro' ? 'var(--success-bg)' : 'var(--surface-alt)',
              }}>
                {b.plan === 'pro' ? 'PRO' : 'FREE'}
              </span>
            </span>
            <span style={{ flex: 1, fontSize: 13, color: 'var(--text-muted)' }}>
              {b.plan === 'free' ? `${b.usedThisMonth} / ${b.monthly_invoice_limit ?? defaultLimit}${b.monthly_invoice_limit ? ' (custom)' : ''}` : '—'}
            </span>
            <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text-faint)' }}>
              {new Date(b.created_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
