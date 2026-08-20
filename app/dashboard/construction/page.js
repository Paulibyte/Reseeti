'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { formatNaira } from '../../../lib/format';

export default function ConstructionPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [openProject, setOpenProject] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from('construction_projects').select('*, customers(name)').eq('business_id', biz.id).order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name, phone').eq('business_id', biz.id).order('name'),
    ]);
    setProjects(p || []);
    setCustomers(c || []);
    setLoading(false);
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageSettings', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage construction projects.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>Construction Projects</h1>
        <button
          onClick={() => setShowNewProject(true)}
          style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}
        >
          + New project
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        Bill a client in stages tied to project milestones, with retention automatically withheld from each payment.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {projects.length === 0 && <p style={{ color: 'var(--text-faint)' }}>No projects yet — add one above.</p>}
        {projects.map((p) => (
          <div
            key={p.id}
            onClick={() => setOpenProject(p)}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 14.5, color: 'var(--heading)' }}>{p.name}</p>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>
                {p.customers?.name || 'No client linked'} · Contract: {formatNaira(p.contract_value)}
                {p.retention_percent > 0 && ` · ${p.retention_percent}% retention`}
                {p.status !== 'active' && ` · ${p.status}`}
              </p>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Manage →</span>
          </div>
        ))}
      </div>

      {showNewProject && (
        <NewProjectForm
          business={business}
          customers={customers}
          onClose={() => setShowNewProject(false)}
          onSaved={() => { setShowNewProject(false); load(); }}
        />
      )}

      {openProject && (
        <ProjectDetail
          business={business}
          project={openProject}
          onClose={() => setOpenProject(null)}
          onChanged={load}
        />
      )}
    </DashboardShell>
  );
}

function NewProjectForm({ business, customers, onClose, onSaved }) {
  const supabase = createClient();
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [description, setDescription] = useState('');
  const [contractValue, setContractValue] = useState('');
  const [retentionPercent, setRetentionPercent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const matchingCustomers = customers.filter((c) =>
    customerSearch && c.name.toLowerCase().includes(customerSearch.toLowerCase())
  ).slice(0, 6);

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Project name is required.'); return; }
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('construction_projects').insert({
      business_id: business.id,
      customer_id: customerId || null,
      name: name.trim(),
      description: description || null,
      contract_value: Number(contractValue) || 0,
      retention_percent: Number(retentionPercent) || 0,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50, overflowY: 'auto' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 22, maxWidth: 420, width: '100%', margin: '20px 0' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>New project</h3>
        <form onSubmit={save}>
          <label style={labelStyle}>Project name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Renovation — 5 Marina Road" />

          <label style={labelStyle}>Client</label>
          <input placeholder="Search customers…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} style={inputStyle} />
          {matchingCustomers.length > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: -8, marginBottom: 10 }}>
              {matchingCustomers.map((c) => (
                <div key={c.id} onClick={() => { setCustomerId(c.id); setCustomerSearch(c.name); }} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', background: customerId === c.id ? 'var(--orange-bg)' : 'transparent' }}>
                  {c.name}
                </div>
              ))}
            </div>
          )}

          <label style={labelStyle}>Description (optional)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Contract value</label>
              <input type="number" min="0" value={contractValue} onChange={(e) => setContractValue(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Retention %</label>
              <input type="number" min="0" max="100" value={retentionPercent} onChange={(e) => setRetentionPercent(e.target.value)} style={inputStyle} placeholder="e.g. 10" />
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: -6, marginBottom: 14 }}>
            The percentage withheld from every milestone payment until the project is complete — leave at 0 if you don&apos;t use retention.
          </p>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Create project'}
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

function ProjectDetail({ business, project, onClose, onChanged }) {
  const supabase = createClient();
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [invoicing, setInvoicing] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { loadMilestones(); }, []);

  async function loadMilestones() {
    const { data } = await supabase.from('construction_milestones').select('*').eq('project_id', project.id).order('sort_order');
    setMilestones(data || []);
    setLoading(false);
  }

  const invoicedTotal = milestones.filter((m) => m.status === 'invoiced').reduce((s, m) => s + Number(m.amount), 0);
  const retentionHeld = invoicedTotal * (Number(project.retention_percent) / 100);
  const remaining = Number(project.contract_value) - milestones.reduce((s, m) => s + Number(m.amount), 0);

  async function addMilestone(e) {
    e.preventDefault();
    if (!newName.trim() || !newAmount) return;
    await supabase.from('construction_milestones').insert({
      business_id: business.id,
      project_id: project.id,
      name: newName.trim(),
      amount: Number(newAmount),
      sort_order: milestones.length,
    });
    setNewName('');
    setNewAmount('');
    loadMilestones();
  }

  async function removeMilestone(m) {
    if (m.status === 'invoiced') return;
    await supabase.from('construction_milestones').delete().eq('id', m.id);
    loadMilestones();
  }

  async function invoiceMilestone(m) {
    if (!project.customer_id) {
      setError('Link a client to this project before invoicing a milestone.');
      return;
    }
    setInvoicing(m.id);
    setError('');

    const retentionAmount = Number(m.amount) * (Number(project.retention_percent) / 100);
    const total = Number(m.amount) - retentionAmount;
    const custRes = await supabase.from('customers').select('name, phone').eq('id', project.customer_id).single();
    const customerInfo = custRes.data;

    const { data: invoice, error: err } = await supabase
      .from('invoices')
      .insert({
        business_id: business.id,
        customer_id: project.customer_id,
        customer_name: customerInfo?.name || '',
        customer_phone: customerInfo?.phone || null,
        subtotal: Number(m.amount),
        discount: 0,
        retention_amount: retentionAmount,
        total,
        construction_project_id: project.id,
      })
      .select('id')
      .single();

    if (err) {
      setInvoicing(null);
      setError(err.message);
      return;
    }

    await supabase.from('invoice_items').insert({
      invoice_id: invoice.id,
      description: `${project.name} — ${m.name}`,
      qty: 1,
      price: Number(m.amount),
      sort_order: 0,
    });

    await supabase.from('construction_milestones').update({ status: 'invoiced', invoice_id: invoice.id }).eq('id', m.id);

    setInvoicing(null);
    loadMilestones();
    onChanged();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50, overflowY: 'auto' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 22, maxWidth: 480, width: '100%', margin: '20px 0' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, marginBottom: 2 }}>{project.name}</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 0, marginBottom: 16 }}>{project.customers?.name || 'No client linked'}</p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 18, background: 'var(--bg)', borderRadius: 8, padding: 12 }}>
          <div><p style={statLabel}>Contract</p><p style={statValue}>{formatNaira(project.contract_value)}</p></div>
          <div><p style={statLabel}>Invoiced</p><p style={statValue}>{formatNaira(invoicedTotal)}</p></div>
          <div><p style={statLabel}>Retention held</p><p style={{ ...statValue, color: 'var(--orange-dark)' }}>{formatNaira(retentionHeld)}</p></div>
          <div><p style={statLabel}>Remaining to bill</p><p style={statValue}>{formatNaira(remaining)}</p></div>
        </div>

        <p style={{ fontWeight: 700, fontSize: 14, margin: '0 0 8px' }}>Milestones</p>
        {loading && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Loading…</p>}
        {!loading && milestones.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No milestones yet — add one below.</p>}
        <div style={{ marginBottom: 14 }}>
          {milestones.map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <span style={{ fontSize: 13.5 }}>{m.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-faint)', marginLeft: 6 }}>{formatNaira(m.amount)}</span>
              </div>
              {m.status === 'invoiced' ? (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', padding: '3px 9px', borderRadius: 20, textTransform: 'uppercase' }}>Invoiced</span>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => invoiceMilestone(m)} disabled={invoicing === m.id} style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                    {invoicing === m.id ? 'Invoicing…' : 'Invoice this milestone'}
                  </button>
                  <button onClick={() => removeMilestone(m)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 11, cursor: 'pointer' }}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 10 }}>{error}</p>}

        <form onSubmit={addMilestone} style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <input placeholder="Milestone name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, flex: 2, marginBottom: 0 }} />
          <input placeholder="Amount" type="number" min="0" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
          <button type="submit" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '0 14px', fontWeight: 700, cursor: 'pointer' }}>+</button>
        </form>

        <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
          Close
        </button>
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 10 };
const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 6, boxSizing: 'border-box' };
const statLabel = { margin: '0 0 2px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase' };
const statValue = { margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' };
