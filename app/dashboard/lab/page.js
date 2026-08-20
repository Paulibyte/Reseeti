'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { formatNaira } from '../../../lib/format';

export default function LabTestOrdersPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [invoicing, setInvoicing] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const [{ data: o }, { data: c }] = await Promise.all([
      supabase.from('lab_test_orders').select('*, customers(name, phone)').eq('business_id', biz.id).order('order_date', { ascending: false }),
      supabase.from('customers').select('id, name, phone').eq('business_id', biz.id).order('name'),
    ]);
    setOrders(o || []);
    setCustomers(c || []);
    setLoading(false);
  }

  async function invoiceOrder(order) {
    setInvoicing(order.id);
    const total = (order.items || []).reduce((s, it) => s + Number(it.price) * Number(it.qty), 0);

    const { data: invoice, error } = await supabase
      .from('invoices')
      .insert({
        business_id: business.id,
        customer_id: order.customer_id,
        customer_name: order.customers?.name || '',
        customer_phone: order.customers?.phone || null,
        subtotal: total,
        discount: 0,
        total,
      })
      .select('id')
      .single();

    if (!error) {
      const itemRows = (order.items || []).map((it, i) => ({
        invoice_id: invoice.id,
        description: it.description,
        qty: it.qty,
        price: it.price,
        sort_order: i,
      }));
      await supabase.from('invoice_items').insert(itemRows);
      await supabase.from('lab_test_orders').update({ invoice_id: invoice.id }).eq('id', order.id);
    }
    setInvoicing(null);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageSettings', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage test orders.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>Lab Test Orders</h1>
        <button onClick={() => setShowForm(true)} style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}>
          + New order
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        Records which tests were billed for an order and generates an invoice. Not a results system: test results are
        never stored here.
      </p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        {orders.length === 0 && <p style={{ padding: 16, color: 'var(--text-faint)', margin: 0 }}>No test orders recorded yet.</p>}
        {orders.map((o, i) => {
          const total = (o.items || []).reduce((s, it) => s + Number(it.price) * Number(it.qty), 0);
          return (
            <div key={o.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: i === orders.length - 1 ? 'none' : '1px solid var(--border)' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{o.customers?.name || 'Patient'} · {formatNaira(total)}</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                  {new Date(o.order_date).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {' · '}{(o.items || []).map((it) => it.description).join(', ')}
                  {o.referring_doctor && ` · Ref: ${o.referring_doctor}`}
                  {o.invoice_id && ' · Invoiced'}
                </p>
              </div>
              {!o.invoice_id && (
                <button onClick={() => invoiceOrder(o)} disabled={invoicing === o.id} style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                  {invoicing === o.id ? 'Invoicing…' : 'Generate invoice'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {showForm && (
        <NewOrderForm
          business={business}
          customers={customers}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </DashboardShell>
  );
}

function NewOrderForm({ business, customers, onClose, onSaved }) {
  const supabase = createClient();
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [mode, setMode] = useState('existing');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [referringDoctor, setReferringDoctor] = useState('');
  const [items, setItems] = useState([{ description: '', qty: 1, price: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const matchingCustomers = customers.filter((c) =>
    customerSearch && (c.name.toLowerCase().includes(customerSearch.toLowerCase()) || (c.phone || '').includes(customerSearch))
  ).slice(0, 6);

  const total = useMemo(
    () => items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0),
    [items]
  );

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
    if (cleanItems.length === 0) { setError('Add at least one test with a name and price.'); return; }

    setSaving(true);
    setError('');

    let finalCustomerId = customerId || null;
    if (mode === 'new') {
      if (!newPatientName.trim()) { setSaving(false); setError("Enter the patient's name."); return; }
      const { data: created, error: custErr } = await supabase
        .from('customers')
        .insert({ business_id: business.id, name: newPatientName.trim(), phone: newPatientPhone || null })
        .select('id')
        .single();
      if (custErr) { setSaving(false); setError(`Could not save patient: ${custErr.message}`); return; }
      finalCustomerId = created.id;
    } else if (!finalCustomerId) {
      setSaving(false);
      setError('Pick an existing patient or switch to "New patient".');
      return;
    }

    const { error: err } = await supabase.from('lab_test_orders').insert({
      business_id: business.id,
      customer_id: finalCustomerId,
      order_date: orderDate,
      referring_doctor: referringDoctor || null,
      items: cleanItems.map((it) => ({ description: it.description, qty: Number(it.qty) || 1, price: Number(it.price) })),
    });

    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50, overflowY: 'auto' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 22, maxWidth: 440, width: '100%', margin: '20px 0' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>New test order</h3>
        <form onSubmit={save}>
          <label style={labelStyle}>Patient</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button type="button" onClick={() => setMode('existing')} style={{ ...tabStyle, ...(mode === 'existing' ? tabActiveStyle : {}) }}>Existing</button>
            <button type="button" onClick={() => setMode('new')} style={{ ...tabStyle, ...(mode === 'new' ? tabActiveStyle : {}) }}>New patient</button>
          </div>
          {mode === 'existing' ? (
            <>
              <input placeholder="Search by name or phone…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} style={inputStyle} />
              {matchingCustomers.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: -8, marginBottom: 12 }}>
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
              <input placeholder="Patient name" value={newPatientName} onChange={(e) => setNewPatientName(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
              <input placeholder="Phone" value={newPatientPhone} onChange={(e) => setNewPatientPhone(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Order date</label>
              <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Referring doctor (optional)</label>
              <input value={referringDoctor} onChange={(e) => setReferringDoctor(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <label style={labelStyle}>Tests ordered</label>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input placeholder="e.g. Full Blood Count" value={it.description} onChange={(e) => updateItem(i, 'description', e.target.value)} style={{ ...inputStyle, flex: 2, marginBottom: 0 }} />
              <input placeholder="Qty" type="number" min="1" value={it.qty} onChange={(e) => updateItem(i, 'qty', e.target.value)} style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
              <input placeholder="Price" type="number" min="0" value={it.price} onChange={(e) => updateItem(i, 'price', e.target.value)} style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
              {items.length > 1 && (
                <button type="button" onClick={() => removeItemRow(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>✕</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addItemRow} style={{ background: 'none', border: 'none', color: 'var(--orange)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}>
            + Add test
          </button>

          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '0 0 14px' }}>Total: {formatNaira(total)}</p>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save order'}
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

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 10 };
const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 6, boxSizing: 'border-box' };
const tabStyle = { flex: 1, padding: '7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
const tabActiveStyle = { border: '1px solid var(--orange)', background: 'var(--orange-bg)', color: 'var(--orange-dark)' };
