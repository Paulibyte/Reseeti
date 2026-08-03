'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { formatNaira } from '../../../lib/format';
import { downloadSubscriptionReceipt } from '../../../lib/subscriptionReceipt';

// Code splitting: UpgradeModal only renders for free-plan businesses at
// their invoice limit, and even then only after the person clicks
// Upgrade — most page loads never need it, so it's fetched as its own
// chunk on first use instead of bundled into every dashboard page.
const UpgradeModal = dynamic(() => import('../UpgradeModal'), { ssr: false });

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Paystack event_types are used as-is (e.g. 'charge.success'). OPay and
// Monnify events are stored prefixed with their gateway (e.g.
// 'opay.success', 'monnify.SUCCESSFUL_TRANSACTION') so all three can share
// one payment_events table — eventMeta() below strips the prefix to find
// the right label and also surfaces which gateway it came from.
const EVENT_LABELS = {
  'charge.success': 'Subscription payment',
  'invoice.payment_failed': 'Payment failed',
  'subscription.disable': 'Subscription cancelled',
  'subscription.create': 'Subscription started',
  success: 'Subscription payment',
  fail: 'Payment failed',
  close: 'Payment cancelled',
  SUCCESSFUL_TRANSACTION: 'Subscription payment',
  FAILED_TRANSACTION: 'Payment failed',
};

const GATEWAY_LABELS = { opay: 'OPay', monnify: 'Monnify' };

function eventMeta(eventType) {
  const [prefix, ...rest] = (eventType || '').split('.');
  const isPrefixed = rest.length > 0 && GATEWAY_LABELS[prefix];
  const key = isPrefixed ? rest.join('.') : eventType;
  const label = EVENT_LABELS[key] || eventType;
  const isFailure = /fail|cancel|disable/i.test(key);
  return {
    label,
    gateway: isPrefixed ? GATEWAY_LABELS[prefix] : 'Paystack',
    color: isFailure ? 'var(--danger)' : 'var(--success)',
    isFailure,
  };
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', flex: '1 1 150px' }}>
      <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: accent || 'var(--text)' }}>{value}</p>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

export default function PaymentsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);

    const { data: invs } = await supabase
      .from('invoices')
      .select('id, invoice_number, customer_name, total, paid, paid_at, created_at')
      .eq('business_id', biz.id)
      .order('created_at', { ascending: false });
    setInvoices(invs || []);

    try {
      const res = await fetch('/api/payments/history');
      const json = await res.json();
      if (res.ok) setEvents(json.events || []);
      else setEventsError(json.error || 'Could not load Paystack transaction history.');
    } catch {
      setEventsError('Could not load Paystack transaction history.');
    }

    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  const paid = useMemo(() => invoices.filter((i) => i.paid), [invoices]);
  const unpaid = useMemo(() => invoices.filter((i) => !i.paid), [invoices]);
  const totalCollected = paid.reduce((s, i) => s + Number(i.total || 0), 0);
  const outstanding = unpaid.reduce((s, i) => s + Number(i.total || 0), 0);

  const thisMonthCollected = useMemo(() => {
    const now = new Date();
    return paid
      .filter((i) => {
        const d = new Date(i.paid_at || i.created_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((s, i) => s + Number(i.total || 0), 0);
  }, [paid]);

  const recentPayments = paid
    .slice()
    .sort((a, b) => new Date(b.paid_at || b.created_at) - new Date(a.paid_at || a.created_at))
    .slice(0, 10);

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!can(role, 'manageSubscription')) {
    return (
      <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to view this page.</p>
      </DashboardShell>
    );
  }

  const renewsAt = business.plan_renews_at ? new Date(business.plan_renews_at) : null;
  const daysToRenew = renewsAt ? Math.ceil((renewsAt - new Date()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut} onUpgradeClick={() => setShowUpgrade(true)}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 16px' }}>
        Payments
      </h1>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <StatCard label="Total collected" value={formatNaira(totalCollected)} sub={`${paid.length} paid invoice${paid.length === 1 ? '' : 's'}`} />
        <StatCard label="This month" value={formatNaira(thisMonthCollected)} />
        <StatCard label="Outstanding" value={formatNaira(outstanding)} accent={outstanding > 0 ? 'var(--danger)' : 'var(--success)'} sub={`${unpaid.length} unpaid invoice${unpaid.length === 1 ? '' : 's'}`} />
        <StatCard
          label="Subscription"
          value={business.plan === 'pro' ? 'Pro' : 'Free'}
          accent={business.plan === 'pro' ? 'var(--success)' : 'var(--text)'}
          sub={business.plan === 'pro'
            ? (renewsAt ? `Renews in ${daysToRenew} day${daysToRenew === 1 ? '' : 's'} (${fmtDate(renewsAt)})` : 'Active')
            : 'Upgrade for unlimited invoices'}
        />
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 18 }}>
        <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)', fontSize: 14, padding: '14px 16px 8px' }}>Recent payments</p>
        {recentPayments.length === 0 && (
          <p style={{ color: 'var(--text-faint)', padding: '0 16px 16px', margin: 0, fontSize: 13.5 }}>
            No payments recorded yet — they'll show up here as invoices get marked paid.
          </p>
        )}
        {recentPayments.map((inv, idx) => (
          <div
            key={inv.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              padding: '12px 16px', borderTop: '1px solid var(--border)',
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{inv.customer_name || 'Unknown customer'}</p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                Invoice {inv.invoice_number} · {fmtDate(inv.paid_at || inv.created_at)}
              </p>
            </div>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: 'var(--success)' }}>+{formatNaira(inv.total)}</p>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)', fontSize: 14, padding: '14px 16px 8px' }}>Subscription gateway activity</p>
        {eventsError && (
          <p style={{ color: 'var(--text-faint)', padding: '0 16px 16px', margin: 0, fontSize: 13.5 }}>{eventsError}</p>
        )}
        {!eventsError && events.length === 0 && (
          <p style={{ color: 'var(--text-faint)', padding: '0 16px 16px', margin: 0, fontSize: 13.5 }}>
            No transactions yet — Paystack, OPay and Monnify charges will be reconciled here automatically once you upgrade.
          </p>
        )}
        {events.map((ev) => {
          const meta = eventMeta(ev.event_type);
          return (
            <div
              key={ev.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '12px 16px', borderTop: '1px solid var(--border)',
              }}
            >
              <div>
                <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>
                  {meta.label}
                  <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 700, color: 'var(--text-faint)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 7px' }}>
                    {meta.gateway}
                  </span>
                </p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                  {ev.reference ? `Ref ${ev.reference} · ` : ''}{fmtDate(ev.created_at)}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <p style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: meta.color }}>
                  {ev.amount ? formatNaira(ev.amount) : '—'}
                </p>
                {!meta.isFailure && ev.amount != null && (
                  <button
                    onClick={() => downloadSubscriptionReceipt({ business, event: { ...ev, gateway: meta.gateway } })}
                    style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '5px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Receipt
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </DashboardShell>
  );
}
