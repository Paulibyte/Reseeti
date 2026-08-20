'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';

const TYPE_LABELS = { text: 'Text', number: 'Number', date: 'Date' };

export default function InvoiceFieldsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState([]);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState('text');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const { data } = await supabase
      .from('custom_field_definitions')
      .select('*')
      .eq('business_id', biz.id)
      .order('sort_order');
    setFields(data || []);
    setLoading(false);
  }

  async function addField(e) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('custom_field_definitions').insert({
      business_id: business.id,
      label: newLabel.trim(),
      field_type: newType,
      sort_order: fields.length,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setNewLabel('');
    setNewType('text');
    load();
  }

  async function removeField(field) {
    if (!confirm(`Remove "${field.label}"? It'll stop appearing on new invoices — invoices that already have a value for it keep showing that value.`)) return;
    await supabase.from('custom_field_definitions').delete().eq('id', field.id);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageSettings', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage invoice fields.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, marginBottom: 4 }}>Invoice Fields</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        Extra fields shown on every invoice you create — e.g. a PO Number, a reference number, or a delivery zone.
        Leave any of them blank on an invoice where they don&apos;t apply.
      </p>

      <form onSubmit={addField} style={{ display: 'flex', gap: 8, marginBottom: 20, maxWidth: 460, flexWrap: 'wrap' }}>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="e.g. PO Number"
          style={{ flex: 2, minWidth: 160, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }}
        />
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value)}
          style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }}
        >
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
        </select>
        <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}>
          Add
        </button>
      </form>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: -10, marginBottom: 14 }}>{error}</p>}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, maxWidth: 460 }}>
        {fields.length === 0 && <p style={{ padding: 16, color: 'var(--text-faint)', margin: 0 }}>No custom fields yet — add one above.</p>}
        {fields.map((f, i) => (
          <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: i === fields.length - 1 ? 'none' : '1px solid var(--border)' }}>
            <span style={{ fontSize: 14, color: 'var(--text)' }}>
              {f.label} <span style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase' }}>· {TYPE_LABELS[f.field_type]}</span>
            </span>
            <button onClick={() => removeField(f)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12, cursor: 'pointer' }}>Remove</button>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
