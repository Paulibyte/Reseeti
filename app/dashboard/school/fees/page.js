'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../../lib/supabaseClient';
import { getMyBusiness } from '../../../../lib/getMyBusiness';
import DashboardShell from '../../DashboardShell';
import { can } from '../../../../lib/permissions';
import { csrfFetch } from '../../../../lib/csrfFetch';
import { formatNaira } from '../../../../lib/format';

export default function FeesPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState([]);
  const [terms, setTerms] = useState([]);
  const [fees, setFees] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedTerm, setSelectedTerm] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const [{ data: cl }, { data: tm }, { data: fe }, { data: inv }] = await Promise.all([
      supabase.from('school_classes').select('*').eq('business_id', biz.id).order('sort_order').order('name'),
      supabase.from('school_terms').select('*, school_sessions(name)').eq('business_id', biz.id).order('created_at', { ascending: false }),
      supabase.from('fee_structures').select('*').eq('business_id', biz.id).order('sort_order'),
      supabase.from('invoices').select('id, student_id, term_id, total, paid').not('student_id', 'is', null),
    ]);
    setClasses(cl || []);
    setTerms(tm || []);
    setFees(fe || []);
    setInvoices(inv || []);
    const current = (tm || []).find((t) => t.is_current);
    setSelectedTerm(current?.id || (tm || [])[0]?.id || '');
    setSelectedClass((cl || [])[0]?.id || '');
    setLoading(false);
  }

  const feesForSelection = useMemo(
    () => fees.filter((f) => f.term_id === selectedTerm && f.class_id === selectedClass),
    [fees, selectedTerm, selectedClass]
  );
  const totalForClass = feesForSelection.reduce((s, f) => s + Number(f.amount), 0);

  const collectionStats = useMemo(() => {
    const termInvoices = invoices.filter((i) => i.term_id === selectedTerm);
    const total = termInvoices.reduce((s, i) => s + Number(i.total), 0);
    const paid = termInvoices.filter((i) => i.paid).reduce((s, i) => s + Number(i.total), 0);
    return { count: termInvoices.length, total, paid, outstanding: total - paid };
  }, [invoices, selectedTerm]);

  async function addFee(e) {
    e.preventDefault();
    if (!newDesc.trim() || !newAmount || !selectedTerm || !selectedClass) return;
    const { error: err } = await supabase.from('fee_structures').insert({
      business_id: business.id,
      class_id: selectedClass,
      term_id: selectedTerm,
      description: newDesc.trim(),
      amount: Number(newAmount),
      sort_order: feesForSelection.length,
    });
    if (err) { setError(err.message); return; }
    setNewDesc('');
    setNewAmount('');
    load();
  }

  async function removeFee(fee) {
    await supabase.from('fee_structures').delete().eq('id', fee.id);
    load();
  }

  async function generateInvoices() {
    if (!selectedTerm) return;
    if (!confirm('Generate fee invoices for every active student for this term? Students already invoiced for it are skipped automatically.')) return;
    setGenerating(true);
    setGenResult(null);
    setError('');
    const res = await csrfFetch('/api/school/generate-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ termId: selectedTerm }),
    });
    const data = await res.json().catch(() => ({}));
    setGenerating(false);
    if (!res.ok) { setError(data.error || 'Could not generate invoices.'); return; }
    setGenResult(data);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageInventory', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage fees.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, marginBottom: 4 }}>Fees</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        Set up fee items per class and term, then generate invoices for everyone at once.
      </p>

      {terms.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>Set up a session and term first, on the Sessions page.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            <select value={selectedTerm} onChange={(e) => setSelectedTerm(e.target.value)} style={selectStyle}>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.school_sessions?.name} — {t.name}</option>)}
            </select>
            <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} style={selectStyle}>
              {classes.length === 0 && <option value="">Add a class first</option>}
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 24, maxWidth: 420 }}>
            <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: 14 }}>Fee items for this class & term</p>
            {feesForSelection.map((f) => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13.5 }}>{f.description}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{formatNaira(f.amount)}</span>
                  <button onClick={() => removeFee(f)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 11, cursor: 'pointer' }}>✕</button>
                </span>
              </div>
            ))}
            {feesForSelection.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>No fee items yet for this selection.</p>}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, fontWeight: 800 }}>
              <span>Total</span><span>{formatNaira(totalForClass)}</span>
            </div>

            <form onSubmit={addFee} style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <input placeholder="e.g. Tuition" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} style={{ ...selectStyle, flex: 2 }} />
              <input placeholder="Amount" type="number" min="0" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} style={{ ...selectStyle, flex: 1 }} />
              <button type="submit" style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '0 14px', fontWeight: 700, cursor: 'pointer' }}>+</button>
            </form>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 20, maxWidth: 420 }}>
            <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: 14 }}>Collection status — this term</p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div><p style={statLabel}>Invoices generated</p><p style={statValue}>{collectionStats.count}</p></div>
              <div><p style={statLabel}>Collected</p><p style={{ ...statValue, color: 'var(--success)' }}>{formatNaira(collectionStats.paid)}</p></div>
              <div><p style={statLabel}>Outstanding</p><p style={{ ...statValue, color: 'var(--danger)' }}>{formatNaira(collectionStats.outstanding)}</p></div>
            </div>
          </div>

          <button
            onClick={generateInvoices}
            disabled={generating}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 20px', fontWeight: 700, cursor: 'pointer' }}
          >
            {generating ? 'Generating…' : '⚡ Generate invoices for this term'}
          </button>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</p>}
          {genResult && (
            <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-muted)', maxWidth: 420 }}>
              <p style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--success)' }}>
                {genResult.created} invoice{genResult.created === 1 ? '' : 's'} created for {genResult.termName}.
              </p>
              {genResult.skippedExisting > 0 && <p style={{ margin: '2px 0' }}>{genResult.skippedExisting} already had an invoice for this term.</p>}
              {genResult.skippedNoParent > 0 && <p style={{ margin: '2px 0' }}>{genResult.skippedNoParent} skipped — no parent contact linked.</p>}
              {genResult.skippedNoFees > 0 && <p style={{ margin: '2px 0' }}>{genResult.skippedNoFees} skipped — no fee items set for their class.</p>}
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}

const selectStyle = { padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13.5 };
const statLabel = { margin: '0 0 2px', fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 700 };
const statValue = { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' };
