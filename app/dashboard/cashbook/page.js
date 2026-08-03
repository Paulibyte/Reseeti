'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { formatNaira } from '../../../lib/format';

// Code splitting: UpgradeModal only renders for free-plan businesses at
// their invoice limit, and even then only after the person clicks
// Upgrade — most page loads never need it, so it's fetched as its own
// chunk on first use instead of bundled into every dashboard page.
const UpgradeModal = dynamic(() => import('../UpgradeModal'), { ssr: false });

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

export default function CashbookPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [month, setMonth] = useState(currentMonthValue());
  const [formType, setFormType] = useState(null); // 'in' | 'out' | null
  const [editingEntry, setEditingEntry] = useState(null);
  const [showOpeningBalance, setShowOpeningBalance] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: r } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(r);

    const { data: rows } = await supabase
      .from('cashbook_entries')
      .select('*')
      .eq('business_id', biz.id)
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true });
    setEntries(rows || []);

    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  async function deleteEntry(entry) {
    if (!confirm(`Delete this Cash ${entry.type === 'in' ? 'In' : 'Out'} entry of ${formatNaira(entry.amount)}?`)) return;
    await supabase.from('cashbook_entries').delete().eq('id', entry.id);
    load();
  }

  // Running balance has to be computed over the FULL history in
  // chronological order — not just the entries visible in the current
  // month filter — so that switching months for review never distorts
  // what the actual cash-on-hand figure was at any given point.
  const withRunningBalance = useMemo(() => {
    let balance = Number(business?.cashbook_opening_balance || 0);
    return entries.map((e) => {
      balance += e.type === 'in' ? Number(e.amount) : -Number(e.amount);
      return { ...e, runningBalance: balance };
    });
  }, [entries, business]);

  const currentBalance = withRunningBalance.length > 0
    ? withRunningBalance[withRunningBalance.length - 1].runningBalance
    : Number(business?.cashbook_opening_balance || 0);

  const monthEntries = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return withRunningBalance.filter((e) => {
      const d = new Date(e.entry_date);
      return d.getFullYear() === y && d.getMonth() === m - 1;
    });
  }, [withRunningBalance, month]);

  const monthCashIn = monthEntries.filter((e) => e.type === 'in').reduce((s, e) => s + Number(e.amount), 0);
  const monthCashOut = monthEntries.filter((e) => e.type === 'out').reduce((s, e) => s + Number(e.amount), 0);

  // Newest first for readability (matches Expenses/Invoices convention),
  // even though the running balance was computed oldest-first.
  const monthEntriesDesc = [...monthEntries].reverse();

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut} onUpgradeClick={() => setShowUpgrade(true)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>
          Cashbook
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
            onClick={() => { setEditingEntry(null); setFormType('in'); }}
            style={{ background: 'var(--success)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
          >
            + Cash In
          </button>
          <button
            onClick={() => { setEditingEntry(null); setFormType('out'); }}
            style={{ background: 'var(--danger)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
          >
            + Cash Out
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', flex: '1 1 170px' }}>
          <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>Balance (cash on hand)</p>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--heading)' }}>{formatNaira(currentBalance)}</p>
          {role === 'owner' && (
            <button
              onClick={() => setShowOpeningBalance(true)}
              style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 11.5, cursor: 'pointer', padding: 0, marginTop: 6, textDecoration: 'underline' }}
            >
              Set opening balance
            </button>
          )}
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', flex: '1 1 150px' }}>
          <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>Cash In this month</p>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--success)' }}>{formatNaira(monthCashIn)}</p>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', flex: '1 1 150px' }}>
          <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>Cash Out this month</p>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>{formatNaira(monthCashOut)}</p>
        </div>
      </div>

      {monthEntries.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 12 }}>📒</div>
          <p style={{ fontWeight: 700, color: 'var(--text)', margin: '0 0 6px', fontSize: 15 }}>No cash movements logged this month</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, maxWidth: 340, margin: '0 auto' }}>
            Every note you receive or pay out in cash — log it here and always know exactly how much you have on hand.
          </p>
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
            <span style={{ flex: '1 1 auto' }}>Description</span>
            <span style={{ flex: '0 0 100px', textAlign: 'right' }}>Cash In</span>
            <span style={{ flex: '0 0 100px', textAlign: 'right' }}>Cash Out</span>
            <span style={{ flex: '0 0 110px', textAlign: 'right' }}>Balance</span>
            <span style={{ flex: '0 0 130px' }} />
          </div>
          {monthEntriesDesc.map((e, idx) => (
            <div
              key={e.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px',
                borderBottom: idx === monthEntriesDesc.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {e.description || (e.type === 'in' ? 'Cash in' : 'Cash out')}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{fmtDate(e.entry_date)}</p>
              </div>
              <span style={{ flex: '0 0 100px', textAlign: 'right', fontWeight: 700, fontSize: 13.5, color: 'var(--success)' }}>
                {e.type === 'in' ? formatNaira(e.amount) : ''}
              </span>
              <span style={{ flex: '0 0 100px', textAlign: 'right', fontWeight: 700, fontSize: 13.5, color: 'var(--danger)' }}>
                {e.type === 'out' ? formatNaira(e.amount) : ''}
              </span>
              <span style={{ flex: '0 0 110px', textAlign: 'right', fontWeight: 700, fontSize: 13.5, color: 'var(--heading)' }}>
                {formatNaira(e.runningBalance)}
              </span>
              <span style={{ flex: '0 0 130px', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => { setEditingEntry(e); setFormType(e.type); }}
                  style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 }}
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteEntry(e)}
                  style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 }}
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {formType && (
        <CashEntryForm
          business={business}
          type={formType}
          entry={editingEntry}
          onClose={() => { setFormType(null); setEditingEntry(null); }}
          onSaved={() => { setFormType(null); setEditingEntry(null); load(); }}
        />
      )}
      {showOpeningBalance && (
        <OpeningBalanceForm
          business={business}
          onClose={() => setShowOpeningBalance(false)}
          onSaved={() => { setShowOpeningBalance(false); load(); }}
        />
      )}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </DashboardShell>
  );
}

function CashEntryForm({ business, type, entry, onClose, onSaved }) {
  const supabase = createClient();
  const isEdit = !!entry;
  const [amount, setAmount] = useState(entry?.amount ?? '');
  const [description, setDescription] = useState(entry?.description || '');
  const [date, setDate] = useState(entry?.entry_date || todayValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isIn = type === 'in';

  async function save(e) {
    e.preventDefault();
    if (Number(amount) <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    setSaving(true);
    setError('');

    const payload = {
      business_id: business.id,
      type,
      amount: Number(amount),
      description: description || null,
      entry_date: date,
    };

    const { data: { user } } = await supabase.auth.getUser();
    if (!isEdit) payload.created_by = user?.id ?? null;

    const { error: err } = isEdit
      ? await supabase.from('cashbook_entries').update(payload).eq('id', entry.id)
      : await supabase.from('cashbook_entries').insert(payload);

    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 380, width: '100%', borderTop: `5px solid ${isIn ? 'var(--success)' : 'var(--danger)'}` }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>
          {isEdit ? `Edit Cash ${isIn ? 'In' : 'Out'}` : isIn ? 'Add Cash In' : 'Add Cash Out'}
        </h3>
        <form onSubmit={save}>
          <label style={labelStyle}>Amount (₦)</label>
          <input required autoFocus type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />

          <label style={labelStyle}>Date</label>
          <input required type="date" max={todayValue()} value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />

          <label style={labelStyle}>Description (optional)</label>
          <input
            placeholder={isIn ? 'e.g. Cash sale, capital from owner' : 'e.g. Supplier payment, transport'}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={inputStyle}
          />

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button
              type="submit"
              disabled={saving}
              style={{ background: isIn ? 'var(--success)' : 'var(--danger)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : isIn ? 'Add Cash In' : 'Add Cash Out'}
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

function OpeningBalanceForm({ business, onClose, onSaved }) {
  const supabase = createClient();
  const [value, setValue] = useState(business.cashbook_opening_balance ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const { error: err } = await supabase
      .from('businesses')
      .update({ cashbook_opening_balance: Number(value) || 0 })
      .eq('id', business.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 360, width: '100%', borderTop: '5px solid var(--orange)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>Set opening balance</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -4 }}>
          The cash you had on hand before you started using Cashbook. Every Cash In and Cash Out entry builds on top of this.
        </p>
        <form onSubmit={save}>
          <label style={labelStyle}>Opening balance (₦)</label>
          <input required type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} style={inputStyle} />

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
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
