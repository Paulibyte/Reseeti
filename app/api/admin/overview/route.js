import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { isPlatformAdmin } from '../../../../lib/isPlatformAdmin';

// Every /api/admin/* route follows the same shape: resolve the caller
// from their session cookie with the normal (anon-key) route client,
// check platform_admins with the service-role client, and only then use
// the service-role client for the actual read/write — never let an
// unauthorized caller's request reach a table-level query at all.
async function requireAdmin() {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  if (!(await isPlatformAdmin(user.id))) {
    return { error: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const admin = createAdminClient();

  const { data: settings } = await admin
    .from('platform_settings')
    .select('free_plan_invoice_limit')
    .single();

  const { data: businesses, error: bizError } = await admin
    .from('businesses')
    .select('id, name, phone, plan, plan_renews_at, plan_grace_until, monthly_invoice_limit, created_at')
    .order('created_at', { ascending: false });

  if (bizError) {
    return NextResponse.json({ error: bizError.message }, { status: 500 });
  }

  // This month's invoice count per business, for the same "X / limit"
  // context an owner sees on their own dashboard — computed the same
  // way enforce_invoice_plan_limit() does it (schema_stage26.sql), just
  // read-side rather than as a trigger check.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { data: counts } = await admin
    .from('invoices')
    .select('business_id')
    .gte('created_at', monthStart.toISOString());

  const countByBusiness = {};
  for (const row of counts || []) {
    countByBusiness[row.business_id] = (countByBusiness[row.business_id] || 0) + 1;
  }

  const businessesWithCounts = (businesses || []).map((b) => ({
    ...b,
    invoicesThisMonth: countByBusiness[b.id] || 0,
  }));

  return NextResponse.json({
    platformSettings: settings || { free_plan_invoice_limit: 5 },
    businesses: businessesWithCounts,
  });
}
