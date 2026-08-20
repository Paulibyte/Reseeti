'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../../lib/supabaseClient';
import { getMyBusiness } from '../../../../lib/getMyBusiness';
import DashboardShell from '../../DashboardShell';
import { can } from '../../../../lib/permissions';

export default function SchoolClassesPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState([]);
  const [newName, setNewName] = useState('');
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
      .from('school_classes')
      .select('*')
      .eq('business_id', biz.id)
      .order('sort_order')
      .order('name');
    setClasses(data || []);
    setLoading(false);
  }

  async function addClass(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('school_classes').insert({
      business_id: business.id,
      name: newName.trim(),
      sort_order: classes.length,
    });
    setSaving(false);
    if (err) {
      setError(err.message.includes('duplicate') ? 'A class with this name already exists.' : err.message);
      return;
    }
    setNewName('');
    load();
  }

  async function removeClass(cls) {
    if (!confirm(`Remove "${cls.name}"? Students and fee structures already linked to it stay, just without a class name.`)) return;
    await supabase.from('school_classes').delete().eq('id', cls.id);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageInventory', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage classes.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, marginBottom: 4 }}>Classes</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        The classes students belong to — used for grouping fee structures and generating invoices per class.
      </p>

      <form onSubmit={addClass} style={{ display: 'flex', gap: 8, marginBottom: 20, maxWidth: 400 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. JSS1, Primary 3"
          style={{ flex: 1, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }}
        />
        <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}>
          Add
        </button>
      </form>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: -10, marginBottom: 14 }}>{error}</p>}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, maxWidth: 400 }}>
        {classes.length === 0 && <p style={{ padding: 16, color: 'var(--text-faint)', margin: 0 }}>No classes yet — add one above.</p>}
        {classes.map((c, i) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: i === classes.length - 1 ? 'none' : '1px solid var(--border)' }}>
            <span style={{ fontSize: 14, color: 'var(--text)' }}>{c.name}</span>
            <button onClick={() => removeClass(c)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12, cursor: 'pointer' }}>Remove</button>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
