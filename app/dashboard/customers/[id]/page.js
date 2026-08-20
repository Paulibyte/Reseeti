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
import { exportCSV, exportExcel, exportPDF } from '../../../../lib/exportTable';

// Code splitting: UpgradeModal only renders for free-plan businesses at
// their invoice limit, and even then only after the person clicks
// Upgrade — most page loads never need it, so it's fetched as its own
// chunk on first use instead of bundled into every dashboard page.
const UpgradeModal = dynamic(() => import('../../UpgradeModal'), { ssr: false });
const RecordPaymentModal = dynamic(() => import('./RecordPaymentModal'), { ssr: false });

export default function CustomerDetailPage() {
  const supabase = createClient();
  const router = useRouter();
  const params = useParams();
  const [business, setBusiness] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', tax_id: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [expandedInvoice, setExpandedInvoice] = useState(null);
  const [recordingPaymentFor, setRecordingPaymentFor] = useState(null);

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

    // Every payment (full or partial) against any of this customer's
    // invoices — this is the actual "how are they paying, and when" log
    // the reviewer feedback asked for, not just a paid/unpaid flag. See
    // schema_stage31.sql for how a partial payment here can accumulate
    // toward an invoice and eventually flip it to paid on its own.
    const ids = (invs || []).map((i) => i.id);
    if (ids.length) {
      const { data: pays } = await supabase
        .from('invoice_payments')
        .select('id, invoice_id, method, amount, created_at')
        .in('invoice_id', ids)
        .order('created_at', { ascending: false });
      setPayments(pays || []);
    } else {
      setPayments([]);
    }

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

  const paymentsFor = (invoiceId) => payments.filter((p) => p.invoice_id === invoiceId);
  const paidSoFar = (invoiceId) => paymentsFor(invoiceId).reduce((s, p) => s + Number(p.amount), 0);
  const PAYMENT_METHOD_LABELS = { cash: 'Cash', transfer: 'Transfer', pos: 'POS', card: 'Card', ussd: 'USSD', other: 'Other' };

  // Balance owed accounts for partial payments already logged against a
  // still-unpaid invoice (Stage 31) — not just the raw invoice total, so
  // a customer who's paid most of what they owe doesn't still show as
  // owing the full original amount.
  const balance = invoices
    .filter((i) => !i.paid)
    .reduce((sum, i) => sum + Math.max(0, Number(i.total) - paidSoFar(i.id)), 0);
  const lifetimeValue = invoices.reduce((sum, i) => sum + Number(i.total), 0);

  // A statement of account — every invoice and every payment merged into
  // one chronological list with a running balance, not just a purchase
  // list. Reuses exportCSV/exportExcel/exportPDF as-is (Reports already
  // built these against a generic {title, columns, rows, totals} shape),
  // so no new PDF/spreadsheet rendering needed for this at all.
  function buildStatementReport() {
    const rows = [];
    for (const inv of invoices) {
      rows.push({
        date: inv.created_at,
        description: `Invoice ${inv.invoice_number}`,
        charge: Number(inv.total),
        payment: 0,
      });
      for (const p of paymentsFor(inv.id)) {
        rows.push({
          date: p.created_at,
          description: `Payment — ${inv.invoice_number} (${p.method})`,
          charge: 0,
          payment: Number(p.amount),
        });
      }
    }
    rows.sort((a, b) => new Date(a.date) - new Date(b.date));

    let running = 0;
    const withBalance = rows.map((r) => {
      running += r.charge - r.payment;
      return {
        date: new Date(r.date).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }),
        description: r.description,
        charge: r.charge > 0 ? formatNaira(r.charge) : '',
        payment: r.payment > 0 ? formatNaira(r.payment) : '',
        balance: formatNaira(running),
      };
    });

    return {
      title: 'Statement of Account',
      subtitle: `${customer.name} — as of ${new Date().toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'description', label: 'Description' },
        { key: 'charge', label: 'Charge', align: 'right' },
        { key: 'payment', label: 'Payment', align: 'right' },
        { key: 'balance', label: 'Balance', align: 'right' },
      ],
      rows: withBalance,
      totals: { description: 'Current balance', balance: formatNaira(running) },
    };
  }

  function statementFilename() {
    return `${(business.name || 'Reseeti').replace(/\s+/g, '_')}-statement-${(customer.name || 'customer').replace(/\s+/g, '_')}`;
  }

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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 16, margin: 0 }}>Purchase history</h3>
        {invoices.length > 0 && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => exportCSV(buildStatementReport(), statementFilename())}
              style={statementBtnStyle}
            >
              CSV
            </button>
            <button
              onClick={() => exportExcel(buildStatementReport(), statementFilename())}
              style={statementBtnStyle}
            >
              Excel
            </button>
            <button
              onClick={() => exportPDF(buildStatementReport(), statementFilename(), business.name)}
              style={{ ...statementBtnStyle, background: 'var(--orange)', color: '#fff', border: 'none' }}
            >
              📄 Statement (PDF)
            </button>
          </div>
        )}
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {invoices.length === 0 && <p style={{ color: 'var(--text-faint)', padding: 16, margin: 0 }}>No invoices for this customer yet.</p>}
        {invoices.map((inv, idx) => {
          const invPayments = paymentsFor(inv.id);
          const paid = paidSoFar(inv.id);
          const remaining = Number(inv.total) - paid;
          const isExpanded = expandedInvoice === inv.id;
          return (
            <div key={inv.id} style={{ borderBottom: idx === invoices.length - 1 ? 'none' : '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
                <a href={`/inv/${inv.id}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--heading)', textDecoration: 'none' }}>
                  {inv.invoice_number}
                </a>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {new Date(inv.created_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text)' }}>{formatNaira(inv.total)}</span>
                  {!inv.paid && paid > 0 && (
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)' }}>
                      {formatNaira(paid)} paid · {formatNaira(remaining)} left
                    </p>
                  )}
                  {inv.paid && inv.paid_at && (
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)' }}>
                      Paid {new Date(inv.paid_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </div>
                <span style={{
                  fontSize: 11, padding: '3px 9px', borderRadius: 12, fontWeight: 700,
                  background: inv.paid ? 'var(--success-bg)' : 'var(--orange-bg)',
                  color: inv.paid ? 'var(--success)' : 'var(--orange-dark)',
                }}>
                  {inv.paid ? 'PAID' : 'UNPAID'}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {!inv.paid && (
                    <button
                      onClick={() => setRecordingPaymentFor(inv)}
                      style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 }}
                    >
                      Record payment
                    </button>
                  )}
                  {invPayments.length > 0 && (
                    <button
                      onClick={() => setExpandedInvoice(isExpanded ? null : inv.id)}
                      style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 }}
                    >
                      {isExpanded ? 'Hide' : 'Payments'} ({invPayments.length})
                    </button>
                  )}
                </div>
              </div>
              {isExpanded && (
                <div style={{ background: 'var(--bg)', padding: '4px 16px 10px 16px' }}>
                  {invPayments.map((p) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12.5 }}>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {new Date(p.created_at).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })} · {PAYMENT_METHOD_LABELS[p.method] || p.method}
                      </span>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{formatNaira(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
      {recordingPaymentFor && (
        <RecordPaymentModal
          invoice={recordingPaymentFor}
          alreadyPaid={paidSoFar(recordingPaymentFor.id)}
          onClose={() => setRecordingPaymentFor(null)}
          onRecorded={() => { setRecordingPaymentFor(null); load(); }}
        />
      )}
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
const statementBtnStyle = { background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const inputStyle = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
  boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
};
