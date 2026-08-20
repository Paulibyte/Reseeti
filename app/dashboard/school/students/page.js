'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../../lib/supabaseClient';
import { getMyBusiness } from '../../../../lib/getMyBusiness';
import DashboardShell from '../../DashboardShell';
import { can } from '../../../../lib/permissions';

export default function StudentsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const [{ data: st }, { data: cl }, { data: cu }] = await Promise.all([
      supabase.from('students').select('*, school_classes(name), customers(name, phone)').eq('business_id', biz.id).order('name'),
      supabase.from('school_classes').select('*').eq('business_id', biz.id).order('sort_order').order('name'),
      supabase.from('customers').select('id, name, phone').eq('business_id', biz.id).order('name'),
    ]);
    setStudents(st || []);
    setClasses(cl || []);
    setCustomers(cu || []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return students.filter((s) =>
      (!classFilter || s.class_id === classFilter) &&
      (!q || s.name.toLowerCase().includes(q) || (s.customers?.name || '').toLowerCase().includes(q))
    );
  }, [students, search, classFilter]);

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageInventory', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage students.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>Students</h1>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}
        >
          + Add student
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        Each student links to a parent/guardian contact — the same one used for invoices, payment history, and the debtor list on Customers.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Search students or parents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13.5 }}
        />
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} style={{ padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13.5 }}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        {filtered.length === 0 && <p style={{ padding: 16, color: 'var(--text-faint)', margin: 0 }}>No students match.</p>}
        {filtered.map((s, i) => (
          <div
            key={s.id}
            onClick={() => { setEditing(s); setShowForm(true); }}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: i === filtered.length - 1 ? 'none' : '1px solid var(--border)', cursor: 'pointer' }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{s.name}</p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                {s.school_classes?.name || 'No class'} · {s.customers ? `Parent: ${s.customers.name}` : 'No parent linked'}
                {s.status !== 'active' && ` · ${s.status}`}
              </p>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>Edit →</span>
          </div>
        ))}
      </div>

      {showForm && (
        <StudentForm
          business={business}
          student={editing}
          classes={classes}
          customers={customers}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </DashboardShell>
  );
}

function StudentForm({ business, student, classes, customers, onClose, onSaved }) {
  const supabase = createClient();
  const isEdit = !!student;
  const [name, setName] = useState(student?.name || '');
  const [classId, setClassId] = useState(student?.class_id || '');
  const [admissionNumber, setAdmissionNumber] = useState(student?.admission_number || '');
  const [status, setStatus] = useState(student?.status || 'active');
  const [parentMode, setParentMode] = useState(student?.parent_customer_id ? 'existing' : 'new');
  const [parentCustomerId, setParentCustomerId] = useState(student?.parent_customer_id || '');
  const [parentSearch, setParentSearch] = useState('');
  const [newParentName, setNewParentName] = useState('');
  const [newParentPhone, setNewParentPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const matchingParents = customers.filter((c) =>
    parentSearch && (c.name.toLowerCase().includes(parentSearch.toLowerCase()) || (c.phone || '').includes(parentSearch))
  ).slice(0, 6);

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Student name is required.'); return; }
    setSaving(true);
    setError('');

    let finalParentId = parentCustomerId || null;
    if (parentMode === 'new' && newParentName.trim()) {
      const { data: created, error: parentErr } = await supabase
        .from('customers')
        .insert({ business_id: business.id, name: newParentName.trim(), phone: newParentPhone || null })
        .select('id')
        .single();
      if (parentErr) { setSaving(false); setError(`Could not save parent contact: ${parentErr.message}`); return; }
      finalParentId = created.id;
    }

    const payload = {
      business_id: business.id,
      name: name.trim(),
      class_id: classId || null,
      admission_number: admissionNumber || null,
      status,
      parent_customer_id: finalParentId,
      updated_at: new Date().toISOString(),
    };

    const { error: err } = isEdit
      ? await supabase.from('students').update(payload).eq('id', student.id)
      : await supabase.from('students').insert(payload);

    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  async function remove() {
    if (!confirm(`Remove ${student.name}? This doesn't delete any invoices already generated for them.`)) return;
    await supabase.from('students').delete().eq('id', student.id);
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50, overflowY: 'auto' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 22, maxWidth: 420, width: '100%', margin: '20px 0' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>{isEdit ? 'Edit student' : 'Add student'}</h3>
        <form onSubmit={save}>
          <label style={labelStyle}>Student name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Class</label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)} style={inputStyle}>
                <option value="">Select class</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Admission no. (optional)</label>
              <input value={admissionNumber} onChange={(e) => setAdmissionNumber(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {isEdit && (
            <>
              <label style={labelStyle}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="graduated">Graduated</option>
              </select>
            </>
          )}

          <label style={labelStyle}>Parent / Guardian</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button type="button" onClick={() => setParentMode('existing')} style={{ ...tabStyle, ...(parentMode === 'existing' ? tabActiveStyle : {}) }}>Existing contact</button>
            <button type="button" onClick={() => setParentMode('new')} style={{ ...tabStyle, ...(parentMode === 'new' ? tabActiveStyle : {}) }}>New contact</button>
          </div>

          {parentMode === 'existing' ? (
            <>
              <input
                placeholder="Search by name or phone…"
                value={parentSearch}
                onChange={(e) => setParentSearch(e.target.value)}
                style={inputStyle}
              />
              {matchingParents.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: -8, marginBottom: 14 }}>
                  {matchingParents.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => { setParentCustomerId(c.id); setParentSearch(c.name); }}
                      style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', background: parentCustomerId === c.id ? 'var(--orange-bg)' : 'transparent' }}
                    >
                      {c.name} {c.phone ? `· ${c.phone}` : ''}
                    </div>
                  ))}
                </div>
              )}
              {parentCustomerId && !parentSearch && (
                <p style={{ fontSize: 12, color: 'var(--success)', marginTop: -8 }}>
                  Linked: {customers.find((c) => c.id === parentCustomerId)?.name}
                </p>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="Parent name" value={newParentName} onChange={(e) => setNewParentName(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
              <input placeholder="Phone" value={newParentPhone} onChange={(e) => setNewParentPhone(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: -6, marginBottom: 14 }}>
            Can be left unlinked for now — invoice generation skips students without a parent contact.
          </p>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 6, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add student'}
              </button>
              <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
            {isEdit && (
              <button type="button" onClick={remove} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 13, cursor: 'pointer' }}>
                Remove
              </button>
            )}
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
