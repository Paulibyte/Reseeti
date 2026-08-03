import Link from 'next/link';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import BusinessOverrideForm from './BusinessOverrideForm';

export const dynamic = 'force-dynamic';

function money(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG');
}

export default async function AdminBusinessDetailPage({ params }) {
  const supabase = createAdminClient();

  const [{ data: business }, { data: invoices }, { data: settings }] = await Promise.all([
    supabase.from('businesses').select('*').eq('id', params.id).single(),
    supabase.from('invoices').select('id, total, paid, created_at').eq('business_id', params.id),
    supabase.from('platform_settings').select('free_plan_invoice_limit').single(),
  ]);

  if (!business) {
    return (
      <div>
        <Link href="/admin/businesses" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Back to businesses</Link>
        <p style={{ color: 'var(--text-faint)', marginTop: 16 }}>Business not found.</p>
      </div>
    );
  }

  const allInvoices = invoices || [];
  const paidInvoices = allInvoices.filter((i) => i.paid);
  const totalRevenue = paidInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const usedThisMonth = allInvoices.filter((i) => new Date(i.created_at) >= startOfMonth).length;

  return (
    <div>
      <Link href="/admin/businesses" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Back to businesses</Link>

      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '10px 0 4px' }}>
        {business.name}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>
        {[business.phone, business.email].filter(Boolean).join(' · ')}
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <StatCard label="Total invoices" value={allInvoices.length} />
        <StatCard label="Paid invoices" value={paidInvoices.length} />
        <StatCard label="Total revenue" value={money(totalRevenue)} />
        <StatCard label="Used this month" value={`${usedThisMonth}${business.plan === 'free' ? ` / ${business.monthly_invoice_limit ?? settings?.free_plan_invoice_limit ?? 5}` : ''}`} />
      </div>

      <BusinessOverrideForm business={business} defaultLimit={settings?.free_plan_invoice_limit ?? 5} />
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', flex: '1 1 150px' }}>
      <p style={{ margin: '0 0 4px', fontSize: 11.5, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{value}</p>
    </div>
  );
}
