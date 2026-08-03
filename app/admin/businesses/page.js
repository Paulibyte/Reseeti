import { createAdminClient } from '../../../lib/supabaseAdmin';
import BusinessesTable from './BusinessesTable';

export const dynamic = 'force-dynamic';

export default async function AdminBusinessesPage() {
  const supabase = createAdminClient();

  const [{ data: businesses }, { data: invoices }, { data: settings }] = await Promise.all([
    supabase.from('businesses').select('id, name, phone, email, plan, plan_renews_at, monthly_invoice_limit, created_at').order('created_at', { ascending: false }),
    supabase.from('invoices').select('business_id, created_at'),
    supabase.from('platform_settings').select('free_plan_invoice_limit').single(),
  ]);
  const defaultLimit = settings?.free_plan_invoice_limit ?? 5;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Invoice counts computed here (server-side, one pass) rather than
  // making the client component do N queries — this stays fine up to a
  // few thousand invoices; if Reseeti grows well past that, this page
  // would want real pagination instead of fetching everything at once.
  const usedThisMonthByBusiness = {};
  (invoices || []).forEach((inv) => {
    if (new Date(inv.created_at) >= startOfMonth) {
      usedThisMonthByBusiness[inv.business_id] = (usedThisMonthByBusiness[inv.business_id] || 0) + 1;
    }
  });

  const rows = (businesses || []).map((b) => ({
    ...b,
    usedThisMonth: usedThisMonthByBusiness[b.id] || 0,
  }));

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 18px' }}>
        Businesses ({rows.length})
      </h1>
      <BusinessesTable rows={rows} defaultLimit={defaultLimit} />
    </div>
  );
}
