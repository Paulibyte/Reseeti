import { createAdminClient } from '../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

function money(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG');
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', flex: '1 1 180px' }}>
      <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: accent || 'var(--text)' }}>{value}</p>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const supabase = createAdminClient();

  const [{ data: businesses }, { data: invoices }] = await Promise.all([
    supabase.from('businesses').select('id, plan, created_at'),
    supabase.from('invoices').select('id, total, paid, created_at'),
  ]);

  const allBusinesses = businesses || [];
  const allInvoices = invoices || [];

  const proCount = allBusinesses.filter((b) => b.plan === 'pro').length;
  const freeCount = allBusinesses.length - proCount;
  const mrr = proCount * 1500;

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const signupsThisWeek = allBusinesses.filter((b) => new Date(b.created_at) >= startOfWeek).length;
  const signupsThisMonth = allBusinesses.filter((b) => new Date(b.created_at) >= startOfMonth).length;

  const paidInvoices = allInvoices.filter((i) => i.paid);
  const totalRevenue = paidInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const invoicesThisMonth = allInvoices.filter((i) => new Date(i.created_at) >= startOfMonth).length;

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 18px' }}>
        Overview
      </h1>

      <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Businesses</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Total businesses" value={allBusinesses.length} />
        <StatCard label="On Pro" value={proCount} accent="var(--success)" sub={`${freeCount} on Free`} />
        <StatCard label="Estimated MRR" value={money(mrr)} sub={`${proCount} × ₦1,500/mo`} />
        <StatCard label="New this week" value={signupsThisWeek} sub={`${signupsThisMonth} this month`} />
      </div>

      <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Platform activity</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="Total invoices" value={allInvoices.length} sub={`${invoicesThisMonth} this month`} />
        <StatCard label="Paid invoices" value={paidInvoices.length} />
        <StatCard label="Total revenue processed" value={money(totalRevenue)} sub="Across all businesses, all time" />
      </div>
    </div>
  );
}
