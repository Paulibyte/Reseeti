import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '../../../../lib/getPlatformAdmin';
import { createAdminClient } from '../../../../lib/supabaseAdmin';

export async function POST(request) {
  const admin = await requirePlatformAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { free_plan_invoice_limit } = await request.json();
  if (!Number.isFinite(free_plan_invoice_limit) || free_plan_invoice_limit < 0) {
    return NextResponse.json({ error: 'Limit must be a non-negative number' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('platform_settings')
    .update({ free_plan_invoice_limit, updated_at: new Date().toISOString() })
    .eq('id', true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
