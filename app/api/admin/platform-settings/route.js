import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { isPlatformAdmin } from '../../../../lib/isPlatformAdmin';
import { verifyCsrfToken } from '../../../../lib/csrf';

export async function POST(req) {
  if (!verifyCsrfToken(req)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!(await isPlatformAdmin(user.id))) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const limit = Number(body.free_plan_invoice_limit);
  if (!Number.isInteger(limit) || limit < 0) {
    return NextResponse.json({ error: 'free_plan_invoice_limit must be a whole number, 0 or more' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('platform_settings')
    .update({ free_plan_invoice_limit: limit })
    .eq('id', 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
