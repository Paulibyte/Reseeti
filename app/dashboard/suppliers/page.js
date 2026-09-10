'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';

const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' };
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 };

export default function SuppliersPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRole, setContactRole] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: r } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(r);

    const { data: sup } = await supabase
      .from('suppliers')
      .select('*, supplier_contacts(*)')
      .eq('business_id', biz.id)
      .order('name');
    setSuppliers(sup || []);
    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  async function addSupplier() {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    const { error: dbError } = await supabase.from('suppliers').insert({
      business_id: business.id,
      name: name.trim(),
      address: address.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (dbError) { setError(dbError.message); return; }
    setName(''); setAddress(''); setNotes(''); setShowForm(false);
    load();
  }

  async function deleteSupplier(id) {
    if (!confirm('Delete this supplier and all their contacts? This does not affect device units already recorded from them.')) return;
    await supabase.from('suppliers').delete().eq('id', id);
    load();
  }

  async function addContact(supplierId) {
    if (!contactName.trim()) return;
    await supabase.from('supplier_contacts').insert({
      business_id: business.id,
      supplier_id: supplierId,
      name: contactName.trim(),
      phone: contactPhone.trim() || null,
      role: contactRole.trim() || null,
    });
    setContactName(''); setContactPhone(''); setContactRole('');
    load();
  }

  async function deleteContact(id) {
    await supabase.from('supplier_contacts').delete().eq('id', id);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
    <div style={{ padding: 20, maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>Suppliers</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
        >
          {showForm ? 'Cancel' : '+ Add supplier'}
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>
        Who you buy stock from — used to link every serialized device unit back to where it came from.
      </p>

      {showForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 20 }}>
          <label style={labelStyle}>Supplier name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Alaba Electronics Ltd" />
          <label style={labelStyle}>Address (optional)</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} style={inputStyle} />
          <label style={labelStyle}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
          <button onClick={addSupplier} disabled={saving || !name.trim()} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Saving…' : 'Save supplier'}
          </button>
        </div>
      )}

      {suppliers.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No suppliers added yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {suppliers.map((s) => (
            <div key={s.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{s.name}</p>
                  {s.address && <p style={{ margin: '0 0 2px', fontSize: 12.5, color: 'var(--text-muted)' }}>{s.address}</p>}
                  {s.notes && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{s.notes}</p>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}
                  >
                    {s.supplier_contacts?.length || 0} contact{s.supplier_contacts?.length === 1 ? '' : 's'}
                  </button>
                  <button
                    onClick={() => deleteSupplier(s.id)}
                    style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {expandedId === s.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  {(s.supplier_contacts || []).map((c) => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
                      <span style={{ color: 'var(--text)' }}>
                        {c.name}{c.role ? ` · ${c.role}` : ''}{c.phone ? ` · ${c.phone}` : ''}
                      </span>
                      <button onClick={() => deleteContact(c.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16, cursor: 'pointer' }}>×</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Name" style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
                    <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Phone" style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
                    <input value={contactRole} onChange={(e) => setContactRole(e.target.value)} placeholder="Role" style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
                    <button
                      onClick={() => addContact(s.id)}
                      disabled={!contactName.trim()}
                      style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 14px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 12.5, whiteSpace: 'nowrap' }}
                    >
                      + Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    </DashboardShell>
  );
}
