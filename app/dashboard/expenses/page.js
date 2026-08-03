'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { formatNaira } from '../../../lib/format';

// Code splitting: UpgradeModal only renders for free-plan businesses at
// their invoice limit, and even then only after the person clicks
// Upgrade — most page loads never need it, so it's fetched as its own
// chunk on first use instead of bundled into every dashboard page.
const UpgradeModal = dynamic(() => import('../UpgradeModal'), { ssr: false });

const CATEGORIES = [
  { value: 'fuel', label: 'Fuel', icon: '⛽' },
  { value: 'transport', label: 'Transport', icon: '🚗' },
  { value: 'salary', label: 'Salary', icon: '💰' },
  { value: 'rent', label: 'Shop rent', icon: '🏠' },
  { value: 'electricity', label: 'Electricity', icon: '⚡' },
  { value: 'internet', label: 'Internet', icon: '🌐' },
  { value: 'other', label: 'Other', icon: '📋' },
];

function categoryMeta(value) {
  return CATEGORIES.find((c) => c.value === value) || CATEGORIES[CATEGORIES.length - 1];
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpensesPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [month, setMonth] = useState(currentMonthValue());
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);

    const { data: exps } = await supabase
      .from('expenses')
      .select('*')
      .eq('business_id', biz.id)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false });
    setExpenses(exps || []);

    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  async function deleteExpense(exp) {
    if (!confirm(`Delete this ${categoryMeta(exp.category).label} expense of ${formatNaira(exp.amount)}?`)) return;
    await supabase.from('expenses').delete().eq('id', exp.id);
    load();
  }

  const monthExpenses = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return expenses.filter((e) => {
      const d = new Date(e.expense_date);
      return d.getFullYear() === y && d.getMonth() === m - 1;
    });
  }, [expenses, month]);

  const monthTotal = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  const byCategory = useMemo(() => {
    const map = {};
    monthExpenses.forEach((e) => {
      map[e.category] = (map[e.category] || 0) + Number(e.amount || 0);
    });
    return CATEGORIES.map((c) => ({ ...c, total: map[c.value] || 0 })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  }, [monthExpenses]);

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!can(role, 'manageExpenses')) {
    return (
      <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to view this page.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut} onUpgradeClick={() => setShowUpgrade(true)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>
          Expenses
        </h1>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="month"
            value={month}
            max={currentMonthValue()}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13.5, background: 'var(--surface)', color: 'var(--text)' }}
          />
          <button
            onClick={() => { setEditingExpense(null); setShowForm(true); }}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
          >
            + Log expense
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', flex: '1 1 150px' }}>
          <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>Total this month</p>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>{formatNaira(monthTotal)}</p>
        </div>
        {byCategory.slice(0, 3).map((c) => (
          <div key={c.value} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', flex: '1 1 150px' }}>
            <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{c.icon} {c.label}</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(c.total)}</p>
          </div>
        ))}
      </div>

      {monthExpenses.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 12 }}>🧾</div>
          <p style={{ fontWeight: 700, color: 'var(--text)', margin: '0 0 6px', fontSize: 15 }}>No expenses logged this month</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, maxWidth: 340, margin: '0 auto' }}>
            Fuel, transport, salaries, rent — log them here and they'll factor into your real profit on Analytics.
          </p>
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {monthExpenses.map((e, idx) => {
            const meta = categoryMeta(e.category);
            return (
              <div
                key={e.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '13px 16px', borderBottom: idx === monthExpenses.length - 1 ? 'none' : '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', background: 'var(--orange-bg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
                  }}>
                    {meta.icon}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', fontSize: 14.5 }}>
                      {meta.label}{e.vendor ? ` — ${e.vendor}` : ''}{e.description ? ` (${e.description})` : ''}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{fmtDate(e.expense_date)}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>{formatNaira(e.amount)}</p>
                  <button
                    onClick={() => { setEditingExpense(e); setShowForm(true); }}
                    style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteExpense(e)}
                    style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <ExpenseForm
          business={business}
          expense={editingExpense}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </DashboardShell>
  );
}

function ExpenseForm({ business, expense, onClose, onSaved }) {
  const supabase = createClient();
  const isEdit = !!expense;
  const [category, setCategory] = useState(expense?.category || 'fuel');
  const [description, setDescription] = useState(expense?.description || '');
  const [vendor, setVendor] = useState(expense?.vendor || '');
  const [amount, setAmount] = useState(expense?.amount ?? '');
  const [date, setDate] = useState(expense?.expense_date || todayValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState('');

  // AI Expense Categorization: reads a photographed receipt via
  // app/api/ai/extract-receipt/route.js and pre-fills the fields above —
  // it never saves anything on its own. A misread amount is real money
  // wrongly recorded in the books if nobody catches it before Save, so
  // this only ever fills in the form for the person to review.
  async function handleReceiptUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file if they try again
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Upload a JPEG, PNG, or WebP photo of the receipt.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('That photo is too large — try a smaller image or a tighter crop of the receipt.');
      return;
    }

    setScanning(true);
    setError('');
    setScanNotice('');
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/ai/extract-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, mediaType: file.type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not read that receipt.');

      if (data.vendor) setVendor(data.vendor);
      if (data.amount != null) setAmount(data.amount);
      if (data.date) setDate(data.date);
      if (data.category) setCategory(data.category);

      if (data.amount == null) {
        setScanNotice("Couldn't make out the amount on that receipt — please fill it in.");
      } else if (data.confidence === 'low') {
        setScanNotice('Receipt read with low confidence — double-check the details before saving.');
      } else {
        setScanNotice('Filled in from the receipt — review before saving.');
      }
    } catch (err) {
      setError(err.message);
    }
    setScanning(false);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      business_id: business.id,
      category,
      description: description || null,
      vendor: vendor || null,
      amount: Number(amount) || 0,
      expense_date: date,
    };

    const { data: { user } } = await supabase.auth.getUser();
    if (!isEdit) payload.created_by = user?.id ?? null;

    const { error: err } = isEdit
      ? await supabase.from('expenses').update(payload).eq('id', expense.id)
      : await supabase.from('expenses').insert(payload);

    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 400, width: '100%', borderTop: '5px solid var(--orange)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>
          {isEdit ? 'Edit expense' : 'Log an expense'}
        </h3>

        {!isEdit && (
          <div style={{ background: 'var(--orange-bg)', border: '1px solid var(--orange)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <label
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700,
                color: 'var(--orange-dark)', cursor: scanning ? 'default' : 'pointer',
              }}
            >
              📷 {scanning ? 'Reading receipt…' : 'Scan a receipt with AI'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleReceiptUpload}
                disabled={scanning}
                style={{ display: 'none' }}
              />
            </label>
            <p style={{ fontSize: 11, color: 'var(--orange-dark)', margin: '4px 0 0', opacity: 0.85 }}>
              Pulls vendor, amount, date, and category from a photo — review before saving.
            </p>
            {scanNotice && <p style={{ fontSize: 11.5, color: 'var(--orange-dark)', margin: '6px 0 0', fontWeight: 600 }}>{scanNotice}</p>}
          </div>
        )}

        <form onSubmit={save}>
          <label style={labelStyle}>Category</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 4px',
                  borderRadius: 8, cursor: 'pointer', fontSize: 10.5, fontWeight: 600,
                  border: category === c.value ? '2px solid var(--orange)' : '1px solid var(--border)',
                  background: category === c.value ? 'var(--orange-bg)' : 'var(--bg)',
                  color: category === c.value ? 'var(--orange-dark)' : 'var(--text-muted)',
                }}
              >
                <span style={{ fontSize: 16 }}>{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>

          <label style={labelStyle}>Amount (₦)</label>
          <input required type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />

          <label style={labelStyle}>Vendor (optional)</label>
          <input
            placeholder="e.g. Total filling station"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            style={inputStyle}
          />

          <label style={labelStyle}>Date</label>
          <input required type="date" max={todayValue()} value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />

          <label style={labelStyle}>Note {category === 'other' ? '' : '(optional)'}</label>
          <input
            required={category === 'other'}
            placeholder={category === 'other' ? 'What was this for?' : 'e.g. Bike fuel for deliveries'}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={inputStyle}
          />

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Log expense'}
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
const inputStyle = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
  boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
};
