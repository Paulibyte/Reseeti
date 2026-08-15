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

  const [tiers, setTiers] = useState([]);
  const [tierDrafts, setTierDrafts] = useState({}); // tier_id -> partial edits not yet saved
  const [savingTierId, setSavingTierId] = useState(null);
  const [showNewTier, setShowNewTier] = useState(false);
  const [newTier, setNewTier] = useState({ id: '', label: '', amount_naira: '', months: '' });
  const [tierError, setTierError] = useState('');

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

    await loadTiers();
  }

  async function loadTiers() {
    const res = await fetch('/api/admin/plan-tiers');
    if (res.ok) {
      const data = await res.json();
      setTiers(data.tiers || []);
    }
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

  async function toggleTierActive(t) {
    setSavingTierId(t.id);
    const res = await csrfFetch(`/api/admin/plan-tiers/${t.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !t.active }),
    });
    setSavingTierId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not update the plan.');
      return;
    }
    setTiers((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: !t.active } : x)));
  }

  async function saveTierEdits(t) {
    const draft = tierDrafts[t.id];
    if (!draft) return;
    setSavingTierId(t.id);
    const res = await csrfFetch(`/api/admin/plan-tiers/${t.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setSavingTierId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not save changes to this plan.');
      return;
    }
    setTiers((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...draft } : x)));
    setTierDrafts((prev) => { const next = { ...prev }; delete next[t.id]; return next; });
  }

  function updateTierDraft(tierId, field, value) {
    setTierDrafts((prev) => ({ ...prev, [tierId]: { ...prev[tierId], [field]: value } }));
  }

  async function createTier(e) {
    e.preventDefault();
    setTierError('');
    const res = await csrfFetch('/api/admin/plan-tiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTier),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setTierError(body.error || 'Could not create the plan.');
      return;
    }
    setNewTier({ id: '', label: '', amount_naira: '', months: '' });
    setShowNewTier(false);
    await loadTiers();
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

      <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Subscription plans</h2>
          <button
            onClick={() => setShowNewTier((v) => !v)}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >
            {showNewTier ? 'Cancel' : '+ Add plan'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -2, marginBottom: 14 }}>
          What shows in the Upgrade screen — edit prices any time without a deploy. Deactivating a plan hides it from new
          checkouts but keeps it intact for businesses already on it.
        </p>

        {showNewTier && (
          <form onSubmit={createTier} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 16, padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
            <div>
              <label style={tinyLabel}>Plan id (slug)</label>
              <input required placeholder="e.g. quarterly" value={newTier.id} onChange={(e) => setNewTier((p) => ({ ...p, id: e.target.value }))} style={tinyInput} />
            </div>
            <div>
              <label style={tinyLabel}>Label</label>
              <input required placeholder="e.g. 3 Months" value={newTier.label} onChange={(e) => setNewTier((p) => ({ ...p, label: e.target.value }))} style={tinyInput} />
            </div>
            <div>
              <label style={tinyLabel}>Amount (₦)</label>
              <input required type="number" min="1" value={newTier.amount_naira} onChange={(e) => setNewTier((p) => ({ ...p, amount_naira: e.target.value }))} style={{ ...tinyInput, width: 100 }} />
            </div>
            <div>
              <label style={tinyLabel}>Months</label>
              <input required type="number" min="1" value={newTier.months} onChange={(e) => setNewTier((p) => ({ ...p, months: e.target.value }))} style={{ ...tinyInput, width: 70 }} />
            </div>
            <button type="submit" style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
              Create
            </button>
            {tierError && <p style={{ width: '100%', color: 'var(--danger)', fontSize: 12.5, margin: 0 }}>{tierError}</p>}
          </form>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tiers.map((t) => {
            const draft = tierDrafts[t.id] || {};
            const hasEdits = Object.keys(draft).length > 0;
            return (
              <div key={t.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, opacity: t.active ? 1 : 0.55 }}>
                <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-faint)', minWidth: 80 }}>{t.id}</span>
                <input
                  value={draft.label !== undefined ? draft.label : t.label}
                  onChange={(e) => updateTierDraft(t.id, 'label', e.target.value)}
                  style={{ ...tinyInput, width: 110 }}
                />
                <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>₦</span>
                <input
                  type="number"
                  min="1"
                  value={draft.amount_naira !== undefined ? draft.amount_naira : t.amount_naira}
                  onChange={(e) => updateTierDraft(t.id, 'amount_naira', e.target.value)}
                  style={{ ...tinyInput, width: 90 }}
                />
                <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>for</span>
                <input
                  type="number"
                  min="1"
                  value={draft.months !== undefined ? draft.months : t.months}
                  onChange={(e) => updateTierDraft(t.id, 'months', e.target.value)}
                  style={{ ...tinyInput, width: 55 }}
                />
                <span style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>month(s)</span>

                {hasEdits && (
                  <button
                    onClick={() => saveTierEdits(t)}
                    disabled={savingTierId === t.id}
                    style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Save
                  </button>
                )}
                <button
                  onClick={() => toggleTierActive(t)}
                  disabled={savingTierId === t.id}
                  style={{
                    marginLeft: 'auto', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                    padding: '5px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
                    background: t.active ? 'var(--success-bg)' : 'var(--surface-alt)',
                    color: t.active ? 'var(--success)' : 'var(--text-faint)',
                  }}
                >
                  {t.active ? 'Active' : 'Inactive'}
                </button>
              </div>
            );
          })}
          {tiers.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No plans yet — add one above.</p>}
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

const tinyLabel = { display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', marginBottom: 3, textTransform: 'uppercase' };
const tinyInput = { padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5, background: 'var(--surface)', color: 'var(--text)' };
