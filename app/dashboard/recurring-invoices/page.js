'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { formatNaira } from '../../../lib/format';

const FREQUENCY_LABELS = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

export default function RecurringInvoicesPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const [{ data: t }, { data: c }] = await Promise.all([
      supabase.from('recurring_invoices').select('*').eq('business_id', biz.id).order('next_run_date'),
      supabase.from('customers').select('id, name, phone').eq('business_id', biz.id).order('name'),
    ]);
    setTemplates(t || []);
    setCustomers(c || []);
    setLoading(false);
  }

  async function toggleActive(t) {
    await supabase.from('recurring_invoices').update({ active: !t.active }).eq('id', t.id);
    load();
  }

  async function removeTemplate(t) {
    if (!confirm(`Stop "${t.customer_name}"'s recurring invoice? Invoices already generated from it stay untouched.`)) return;
    await supabase.from('recurring_invoices').delete().eq('id', t.id);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageSettings', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage recurring invoices.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>Recurring Invoices</h1>
        <button
          onClick={() => setShowForm(true)}
          style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}
        >
          + New recurring invoice
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        Automatically generates a real invoice on schedule — a subscription, a monthly retainer, rent, anything you bill on a repeat basis.
      </p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        {templates.length === 0 && <p style={{ padding: 16, color: 'var(--text-faint)', margin: 0 }}>No recurring invoices set up yet.</p>}
        {templates.map((t, i) => {
          const total = (t.items || []).reduce((s, it) => s + Number(it.price) * Number(it.qty), 0) - Number(t.discount || 0);
          return (
            <div key={t.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: i === templates.length - 1 ? 'none' : '1px solid var(--border)', opacity: t.active ? 1 : 0.55 }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{t.customer_name} · {formatNaira(total)}</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                  {FREQUENCY_LABELS[t.frequency]} · next: {new Date(t.next_run_date).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {!t.active && ' · Paused'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => toggleActive(t)} style={smallBtnStyle}>{t.active ? 'Pause' : 'Resume'}</button>
                <button onClick={() => removeTemplate(t)} style={{ ...smallBtnStyle, color: 'var(--danger)' }}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <NewTemplateForm
          business={business}
          customers={customers}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </DashboardShell>
  );
}

function NewTemplateForm({ business, customers, onClose, onSaved }) {
  const supabase = createClient();
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [mode, setMode] = useState('existing');
  const [items, setItems] = useState([{ description: '', qty: 1, price: '' }]);
  const [discount, setDiscount] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDaysAfter, setDueDaysAfter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const matchingCustomers = customers.filter((c) =>
    customerSearch && (c.name.toLowerCase().includes(customerSearch.toLowerCase()) || (c.phone || '').includes(customerSearch))
  ).slice(0, 6);

  const total = useMemo(() => {
    const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
    return Math.max(0, subtotal - (Number(discount) || 0));
  }, [items, discount]);

  function updateItem(i, field, value) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }
  function addItemRow() {
    setItems((prev) => [...prev, { description: '', qty: 1, price: '' }]);
  }
  function removeItemRow(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save(e) {
    e.preventDefault();
    const cleanItems = items.filter((it) => it.description.trim() && Number(it.price) > 0);
    if (cleanItems.length === 0) { setError('Add at least one item with a description and price.'); return; }

    setSaving(true);
    setError('');

    let finalCustomerId = customerId || null;
    let finalCustomerName = customers.find((c) => c.id === customerId)?.name || '';
    let finalCustomerPhone = customers.find((c) => c.id === customerId)?.phone || '';

    if (mode === 'new') {
      if (!newCustomerName.trim()) { setSaving(false); setError('Enter a customer name.'); return; }
      const { data: created, error: custErr } = await supabase
        .from('customers')
        .insert({ business_id: business.id, name: newCustomerName.trim(), phone: newCustomerPhone || null })
        .select('id, name, phone')
        .single();
      if (custErr) { setSaving(false); setError(`Could not save customer: ${custErr.message}`); return; }
      finalCustomerId = created.id;
      finalCustomerName = created.name;
      finalCustomerPhone = created.phone;
    } else if (!finalCustomerId) {
      setSaving(false);
      setError('Pick an existing customer or switch to "New customer".');
      return;
    }

    const { error: err } = await supabase.from('recurring_invoices').insert({
      business_id: business.id,
      customer_id: finalCustomerId,
      customer_name: finalCustomerName,
      customer_phone: finalCustomerPhone || null,
      items: cleanItems.map((it) => ({ description: it.description, qty: Number(it.qty) || 1, price: Number(it.price) })),
      discount: Number(discount) || 0,
      due_days_after: dueDaysAfter ? Number(dueDaysAfter) : null,
      frequency,
      next_run_date: startDate,
    });

    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50, overflowY: 'auto' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 22, maxWidth: 460, width: '100%', margin: '20px 0' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>New recurring invoice</h3>
        <form onSubmit={save}>
          <label style={labelStyle}>Customer</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button type="button" onClick={() => setMode('existing')} style={{ ...tabStyle, ...(mode === 'existing' ? tabActiveStyle : {}) }}>Existing</button>
            <button type="button" onClick={() => setMode('new')} style={{ ...tabStyle, ...(mode === 'new' ? tabActiveStyle : {}) }}>New customer</button>
          </div>
          {mode === 'existing' ? (
            <>
              <input placeholder="Search by name or phone…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} style={inputStyle} />
              {matchingCustomers.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: -8, marginBottom: 14 }}>
                  {matchingCustomers.map((c) => (
                    <div key={c.id} onClick={() => { setCustomerId(c.id); setCustomerSearch(c.name); }} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', background: customerId === c.id ? 'var(--orange-bg)' : 'transparent' }}>
                      {c.name} {c.phone ? `· ${c.phone}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input placeholder="Customer name" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
              <input placeholder="Phone" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            </div>
          )}

          <label style={labelStyle}>Items</label>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input placeholder="Description" value={it.description} onChange={(e) => updateItem(i, 'description', e.target.value)} style={{ ...inputStyle, flex: 2, marginBottom: 0 }} />
              <input placeholder="Qty" type="number" min="1" value={it.qty} onChange={(e) => updateItem(i, 'qty', e.target.value)} style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
              <input placeholder="Price" type="number" min="0" value={it.price} onChange={(e) => updateItem(i, 'price', e.target.value)} style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
              {items.length > 1 && (
                <button type="button" onClick={() => removeItemRow(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>✕</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addItemRow} style={{ background: 'none', border: 'none', color: 'var(--orange)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}>
            + Add item
          </button>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Discount (optional)</label>
              <input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Due within (days, optional)</label>
              <input type="number" min="0" value={dueDaysAfter} onChange={(e) => setDueDaysAfter(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Repeats</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)} style={inputStyle}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Starting</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '4px 0 14px' }}>Total per invoice: {formatNaira(total)}</p>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Create'}
            </button>
            <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const smallBtnStyle = { background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--text)' };
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 10 };
const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 6, boxSizing: 'border-box' };
const tabStyle = { flex: 1, padding: '7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
const tabActiveStyle = { border: '1px solid var(--orange)', background: 'var(--orange-bg)', color: 'var(--orange-dark)' };
