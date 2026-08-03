'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { cacheGetAll, cacheSetAll } from '../../../lib/idbCache';
import { useRealtimeSync } from '../../../lib/useRealtimeSync';

// Rendered a page at a time rather than all at once — a business with a
// few thousand customers would otherwise mean a few thousand mounted
// <Link> rows (each with its own inline styles and event handlers) on
// every visit to this page, most of which are scrolled past and never
// seen.
const PAGE_SIZE = 25;

// Code splitting: UpgradeModal only renders for free-plan businesses at
// their invoice limit, and even then only after the person clicks
// Upgrade — most page loads never need it, so it's fetched as its own
// chunk on first use instead of bundled into every dashboard page.
const UpgradeModal = dynamic(() => import('../UpgradeModal'), { ssr: false });
const ImportModal = dynamic(() => import('../ImportModal'), { ssr: false });

export default function CustomersPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newTaxId, setNewTaxId] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => { load(); }, []);
  // Any time the search text changes the result set shifts, so jump back
  // to page 1 rather than potentially landing on a now-empty later page.
  useEffect(() => { setPage(0); }, [search]);

  // Live cross-device sync — see the identical pattern in
  // inventory/page.js's products subscription for the reasoning.
  useRealtimeSync(supabase, 'customers', business?.id, (payload) => {
    setCustomers((prev) => {
      if (payload.eventType === 'DELETE') {
        return prev.filter((c) => c.id !== payload.old.id);
      }
      const exists = prev.some((c) => c.id === payload.new.id);
      if (exists) {
        return prev.map((c) => (c.id === payload.new.id ? payload.new : c));
      }
      return [...prev, payload.new].sort((a, b) => a.name.localeCompare(b.name));
    });
  });

  async function load() {
    const { user, business: biz, role: myRole } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);

    // Instant paint from the last cached snapshot while the network
    // request is still in flight — see lib/idbCache.js.
    const cachedCustomers = await cacheGetAll('customers', biz.id);
    if (cachedCustomers.length) {
      setCustomers(cachedCustomers);
      setLoading(false);
    }

    const { data: custs } = await supabase
      .from('customers')
      .select('*')
      .eq('business_id', biz.id)
      .order('name');
    setCustomers(custs || []);
    cacheSetAll('customers', biz.id, custs || []);

    // Pulled alongside customers to compute purchase history / outstanding
    // balance per customer without a separate round trip per row.
    const { data: invs } = await supabase
      .from('invoices')
      .select('id, customer_id, customer_name, customer_phone, total, paid, created_at')
      .eq('business_id', biz.id);
    setInvoices(invs || []);

    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  async function addCustomer(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const { error: err } = await supabase.from('customers').insert({
      business_id: business.id,
      name: newName,
      phone: newPhone || null,
      email: newEmail || null,
      address: newAddress || null,
      tax_id: newTaxId || null,
      notes: newNotes || null,
    });
    setSaving(false);
    if (err) {
      // Most likely cause: the (business_id, phone) unique constraint —
      // a customer with this phone number already exists.
      setError(err.message.includes('duplicate') ? 'A customer with this phone number already exists.' : err.message);
      return;
    }
    setNewName('');
    setNewPhone('');
    setNewEmail('');
    setNewAddress('');
    setNewTaxId('');
    setNewNotes('');
    setShowAdd(false);
    load();
  }

  // Stats keyed by customer_id where available, falling back to matching
  // on phone/name for invoices created before this stage (which won't
  // have a customer_id set).
  const statsByCustomer = useMemo(() => {
    const map = {};
    invoices.forEach((inv) => {
      const key = inv.customer_id || `legacy:${inv.customer_phone || inv.customer_name}`;
      if (!map[key]) map[key] = { count: 0, balance: 0 };
      map[key].count += 1;
      if (!inv.paid) map[key].balance += Number(inv.total);
    });
    return map;
  }, [invoices]);

  function statsFor(customer) {
    return statsByCustomer[customer.id] || statsByCustomer[`legacy:${customer.phone || customer.name}`] || { count: 0, balance: 0 };
  }

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone || '').includes(search)
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!can(role, 'manageCustomers')) {
    return (
      <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to view this page.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut} onUpgradeClick={() => setShowUpgrade(true)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>
          Customers
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowImport(true)}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            ⬆ Import
          </button>
          <button
            onClick={() => setShowAdd(true)}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
          >
            + Add customer
          </button>
        </div>
      </div>

      <input
        placeholder="Search by name or phone"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%', padding: '11px 14px', border: '1px solid var(--border)', borderRadius: 8,
          fontSize: 14, marginBottom: 18, boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)',
        }}
      />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {filtered.length === 0 && (
          <p style={{ color: 'var(--text-faint)', padding: 16, margin: 0 }}>
            {customers.length === 0 ? 'No customers yet — they\'ll appear here automatically once you invoice someone, or add one directly.' : 'No matches.'}
          </p>
        )}
        {pageItems.map((c, idx) => {
          const stats = statsFor(c);
          return (
            <Link
              key={c.id}
              href={`/dashboard/customers/${c.id}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '14px 16px', textDecoration: 'none',
                borderBottom: idx === pageItems.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', background: 'var(--orange-bg)', color: 'var(--orange-dark)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0,
                }}>
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', fontSize: 14.5 }}>{c.name}</p>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>{c.phone || '—'}</p>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {stats.count} invoice{stats.count === 1 ? '' : 's'}
                </p>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: stats.balance > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {stats.balance > 0 ? `₦${stats.balance.toLocaleString()} owed` : 'Settled'}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {filtered.length > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 14 }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 12px', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.5 : 1, fontSize: 13 }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Page {page + 1} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 12px', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1, fontSize: 13 }}
          >
            Next →
          </button>
        </div>
      )}

      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 380, width: '100%', borderTop: '5px solid var(--orange)' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>Add customer</h3>
            <form onSubmit={addCustomer}>
              <input
                placeholder="Full name"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
              />
              <input
                placeholder="Phone number"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
              />
              <input
                type="email"
                placeholder="Email (optional)"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
              />
              <input
                placeholder="Address (optional)"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
              />
              <input
                placeholder="Tax ID (optional)"
                value={newTaxId}
                onChange={(e) => setNewTaxId(e.target.value)}
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
              />
              <textarea
                placeholder="Notes (optional)"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }}
              />
              {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Add customer'}
                </button>
                <button type="button" onClick={() => setShowAdd(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      {showImport && (
        <ImportModal
          title="Import customers"
          table="customers"
          business={business}
          supabase={supabase}
          onClose={() => setShowImport(false)}
          onImported={load}
          columns={[
            { key: 'name', required: true, example: 'Ada Okafor' },
            { key: 'phone', example: '08012345678' },
            { key: 'email', example: 'ada@example.com' },
            { key: 'address', example: '12 Marina Road, Lagos' },
            { key: 'tax_id', example: '' },
          ]}
        />
      )}
    </DashboardShell>
  );
}
