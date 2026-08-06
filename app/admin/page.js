'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabaseClient';
import { csrfFetch } from '../../lib/csrfFetch';

// Platform-operator dashboard — deliberately separate from
// /dashboard/**, which is always scoped to one business via
// business_members. This page isn't scoped to any business; access is
// gated by the platform_admins table (see schema_stage29.sql), checked
// server-side in every /api/admin/** route since that table has no
// client-readable RLS policy at all. This page itself just calls those
// routes and renders what comes back — it never queries Supabase
// directly the way /dashboard/** pages do, since an admin's own session
// has no special Postgres-level privilege of its own.
export default function AdminPage() {
  const supabase = createClient();
  const router = useRouter();

  const [status, setStatus] = useState('loading'); // loading | unauthorized | signedOut | ready
  const [platformLimit, setPlatformLimit] = useState('');
  const [savingLimit, setSavingLimit] = useState(false);
  const [businesses, setBusinesses] = useState([]);
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [drafts, setDrafts] = useState({}); // business_id -> { monthly_invoice_limit }
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setStatus('signedOut'); return; }

    const res = await fetch('/api/admin/overview');
    if (res.status === 401) { setStatus('signedOut'); return; }
    if (res.status === 403) { setStatus('unauthorized'); return; }
    if (!res.ok) { setError('Something went wrong loading the admin dashboard.'); setStatus('ready'); return; }

    const data = await res.json();
    setPlatformLimit(String(data.platformSettings?.free_plan_invoice_limit ?? 5));
    setBusinesses(data.businesses || []);
    setStatus('ready');
  }

  async function saveLimit() {
    setSavingLimit(true);
    setError('');
    const res = await csrfFetch('/api/admin/platform-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ free_plan_invoice_limit: Number(platformLimit) }),
    });
    setSavingLimit(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Could not save the platform limit.');
    }
  }

  async function togglePlan(biz) {
    const nextPlan = biz.plan === 'pro' ? 'free' : 'pro';
    if (!confirm(`Switch ${biz.name} to ${nextPlan === 'pro' ? 'Pro' : 'Free'}?`)) return;
    setSavingId(biz.id);
    const res = await csrfFetch(`/api/admin/businesses/${biz.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: nextPlan }),
    });
    setSavingId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not change the plan.');
      return;
    }
    setBusinesses((prev) => prev.map((b) => (b.id === biz.id ? { ...b, plan: nextPlan } : b)));
  }

  async function saveCustomLimit(biz) {
    const raw = drafts[biz.id]?.monthly_invoice_limit;
    const value = raw === undefined ? biz.monthly_invoice_limit : raw;
    const payload = value === '' || value === null ? null : Number(value);
    setSavingId(biz.id);
    const res = await csrfFetch(`/api/admin/businesses/${biz.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthly_invoice_limit: payload }),
    });
    setSavingId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not save the custom limit.');
      return;
    }
    setBusinesses((prev) => prev.map((b) => (b.id === biz.id ? { ...b, monthly_invoice_limit: payload } : b)));
    setDrafts((prev) => { const next = { ...prev }; delete next[biz.id]; return next; });
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (status === 'loading') {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (status === 'signedOut') {
    router.push('/login');
    return null;
  }

  if (status === 'unauthorized') {
    return (
      <main style={{ padding: 40, maxWidth: 480 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)' }}>Not authorized</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          This account isn&apos;t registered as a platform admin. See <code>supabase/schema_stage29.sql</code> for
          how to add yourself.
        </p>
        <button
          onClick={() => router.push('/dashboard')}
          style={{ marginTop: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' }}
        >
          Back to my dashboard
        </button>
      </main>
    );
  }

  const filtered = businesses.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()) || (b.phone || '').includes(search)
  );

  return (
    <main style={{ maxWidth: 920, margin: '0 auto', padding: '24px 20px 60px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', margin: 0, fontSize: 24 }}>
          Reseeti Admin
        </h1>
        <button
          onClick={signOut}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </header>

      {error && (
        <p style={{ background: 'var(--danger-bg, #fee)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 8, fontSize: 13.5 }}>
          {error}
        </p>
      )}

      <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Platform settings</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -6 }}>
          Default monthly invoice limit for every Free-plan business, unless a business has its own custom limit below.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="number"
            min="0"
            value={platformLimit}
            onChange={(e) => setPlatformLimit(e.target.value)}
            style={{ width: 100, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
          />
          <button
            onClick={saveLimit}
            disabled={savingLimit}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 700, cursor: 'pointer' }}
          >
            {savingLimit ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Businesses ({businesses.length})</h2>
          <input
            placeholder="Search name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13.5, width: 220 }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((b) => (
            <div
              key={b.id}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                padding: '14px 16px', display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center',
              }}
            >
              <div style={{ flex: '1 1 200px', minWidth: 160 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{b.name}</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{b.phone || 'No phone'}</p>
              </div>

              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {b.invoicesThisMonth} invoices this month
                {b.plan === 'free' && (
                  <> / {b.monthly_invoice_limit ?? (Number(platformLimit) || 5)} limit</>
                )}
              </div>

              <button
                onClick={() => togglePlan(b)}
                disabled={savingId === b.id}
                style={{
                  fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                  padding: '5px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
                  background: b.plan === 'pro' ? 'var(--success-bg)' : 'var(--surface-alt)',
                  color: b.plan === 'pro' ? 'var(--success)' : 'var(--text-faint)',
                }}
              >
                {b.plan === 'pro' ? 'Pro' : 'Free'} — click to switch
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number"
                  min="0"
                  placeholder="custom limit"
                  value={
                    drafts[b.id]?.monthly_invoice_limit !== undefined
                      ? drafts[b.id].monthly_invoice_limit
                      : (b.monthly_invoice_limit ?? '')
                  }
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [b.id]: { monthly_invoice_limit: e.target.value } }))}
                  style={{ width: 100, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5 }}
                />
                <button
                  onClick={() => saveCustomLimit(b)}
                  disabled={savingId === b.id}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                  Save
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No businesses match &quot;{search}&quot;.</p>
          )}
        </div>
      </section>
    </main>
  );
}
