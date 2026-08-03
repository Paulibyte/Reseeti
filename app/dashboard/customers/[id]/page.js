'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../../../lib/supabaseClient';
import { getMyBusiness } from '../../../../lib/getMyBusiness';
import DashboardShell from '../../DashboardShell';
import { formatNaira } from '../../../../lib/format';
import { queueEdit } from '../../../../lib/offlineQueue';

// Code splitting: UpgradeModal only renders for free-plan businesses at
// their invoice limit, and even then only after the person clicks
// Upgrade — most page loads never need it, so it's fetched as its own
// chunk on first use instead of bundled into every dashboard page.
const UpgradeModal = dynamic(() => import('../../UpgradeModal'), { ssr: false });

export default function CustomerDetailPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useParams();
  const [business, setBusiness] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', tax_id: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => { load(); }, [params.id]);

  async function load() {
    const { user, business: biz } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);

    const { data: cust } = await supabase
      .from('customers')
      .select('*')
      .eq('id', params.id)
      .eq('business_id', biz.id)
      .single();
    setCustomer(cust);
    if (cust) setForm({
      name: cust.name,
      phone: cust.phone || '',
      email: cust.email || '',
      address: cust.address || '',
      tax_id: cust.tax_id || '',
      notes: cust.notes || '',
    });

    const { data: invs } = await supabase
      .from('invoices')
      .select('*, invoice_items(*)')
      .eq('business_id', biz.id)
      .eq('customer_id', params.id)
      .order('created_at', { ascending: false });
    setInvoices(invs || []);

    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);

    const changes = {
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      tax_id: form.tax_id || null,
      notes: form.notes,
    };

    // Same offline-edit queueing as ProductForm.jsx's save() — see that
    // file's comment for the full reasoning on baseUpdatedAt and why
    // this only covers edits to an existing customer, not new-customer
    // creation.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      queueEdit({ table: 'customers', id: customer.id, changes, baseUpdatedAt: customer.updated_at });
      setCustomer((prev) => ({ ...prev, ...changes }));
      setSaving(false);
      setEditing(false);
      return;
    }

    await supabase
      .from('customers')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', customer.id);
    setSaving(false);
    setEditing(false);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!customer) {
    return (
      <DashboardShell plan={business.plan} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>Customer not found.</p>
        <Link href="/dashboard/customers" style={{ color: 'var(--heading)', fontWeight: 600 }}>← Back to customers</Link>
      </DashboardShell>
    );
  }

  const balance = invoices.filter((i) => !i.paid).reduce((sum, i) => sum + Number(i.total), 0);
  const lifetimeValue = invoices.reduce((sum, i) => sum + Number(i.total), 0);

  return (
    <DashboardShell plan={business.plan} onSignOut={signOut} onUpgradeClick={() => setShowUpgrade(true)}>
      <Link href="/dashboard/customers" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', display: 'inline-block', marginBottom: 14 }}>
        ← Back to customers
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%', background: 'var(--orange-bg)', color: 'var(--orange-dark)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 20, flexShrink: 0,
          }}>
            {customer.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>{customer.name}</h1>
            <p style={{ margin: '2px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>{customer.phone || 'No phone on file'}</p>
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          Edit profile
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 22 }}>
        <StatCard label="Outstanding balance" value={formatNaira(balance)} accent={balance > 0 ? 'var(--danger)' : 'var(--success)'} />
        <StatCard label="Lifetime value" value={formatNaira(lifetimeValue)} />
        <StatCard label="Total invoices" value={invoices.length} />
      </div>

      {(customer.email || customer.address || customer.tax_id) && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16, display: 'grid', gap: 10 }}>
          {customer.email && (
            <div>
              <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-faint)', margin: '0 0 3px' }}>Email</p>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{customer.email}</p>
            </div>
          )}
          {customer.address && (
            <div>
              <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-faint)', margin: '0 0 3px' }}>Address</p>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{customer.address}</p>
            </div>
          )}
          {customer.tax_id && (
            <div>
              <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-faint)', margin: '0 0 3px' }}>Tax ID</p>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{customer.tax_id}</p>
            </div>
          )}
        </div>
      )}

      {customer.notes && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 22 }}>
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-faint)', margin: '0 0 6px' }}>Notes</p>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{customer.notes}</p>
        </div>
      )}

      <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 16, marginBottom: 12 }}>Purchase history</h3>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {invoices.length === 0 && <p style={{ color: 'var(--text-faint)', padding: 16, margin: 0 }}>No invoices for this customer yet.</p>}
        {invoices.map((inv, idx) => (
          <a
            key={inv.id}
            href={`/inv/${inv.id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 16px',
              textDecoration: 'none', borderBottom: idx === invoices.length - 1 ? 'none' : '1px solid var(--border)',
            }}
          >
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--heading)' }}>{inv.invoice_number}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {new Date(inv.created_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <span style={{ fontWeight: 700, color: 'var(--text)' }}>{formatNaira(inv.total)}</span>
            <span style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 12, fontWeight: 700,
              background: inv.paid ? 'var(--success-bg)' : 'var(--orange-bg)',
              color: inv.paid ? 'var(--success)' : 'var(--orange-dark)',
            }}>
              {inv.paid ? 'PAID' : 'UNPAID'}
            </span>
          </a>
        ))}
      </div>

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 420, width: '100%', borderTop: '5px solid var(--orange)' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>Edit customer</h3>
            <form onSubmit={saveProfile}>
              <label style={labelStyle}>Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} />
              <label style={labelStyle}>Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={inputStyle} />
              <label style={labelStyle}>Email (optional)</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={inputStyle} />
              <label style={labelStyle}>Address (optional)</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={inputStyle} />
              <label style={labelStyle}>Tax ID (optional)</label>
              <input value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} style={inputStyle} />
              <label style={labelStyle}>Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Prefers delivery after 4pm, always pays via transfer…"
                rows={4}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditing(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </DashboardShell>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-faint)', margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, color: accent || 'var(--heading)', margin: 0 }}>{value}</p>
    </div>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 10 };
const inputStyle = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
  boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
};
