import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '../../../../../lib/getPlatformAdmin';
import { createAdminClient } from '../../../../../lib/supabaseAdmin';

export async function PATCH(request, { params }) {
  const admin = await requirePlatformAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { plan, plan_renews_at, monthly_invoice_limit } = await request.json();

  if (plan !== 'free' && plan !== 'pro') {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }
  if (monthly_invoice_limit !== null && (!Number.isFinite(monthly_invoice_limit) || monthly_invoice_limit < 0)) {
    return NextResponse.json({ error: 'Invoice limit must be a non-negative number, or left unset' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('businesses')
    .update({ plan, plan_renews_at, monthly_invoice_limit })
    .eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
