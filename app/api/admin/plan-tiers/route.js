import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { isPlatformAdmin } from '../../../../lib/isPlatformAdmin';
import { verifyCsrfToken } from '../../../../lib/csrf';

// Tier ids double as a segment inside OPay's '__'-delimited checkout
// reference (see app/api/opay/initialize/route.js), so they're kept to
// a safe, unambiguous slug shape here at creation time rather than
// trusting free text.
const ID_PATTERN = /^[a-z0-9-]{2,30}$/;

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
  const { data, error: dbError } = await admin
    .from('plan_tiers')
    .select('*')
    .order('sort_order');

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }
  return NextResponse.json({ tiers: data || [] });
}

export async function POST(req) {
  if (!verifyCsrfToken(req)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '').trim().toLowerCase();
  const label = String(body.label || '').trim();
  const amountNaira = Number(body.amount_naira);
  const months = Number(body.months);

  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Plan id must be 2-30 lowercase letters, digits, or hyphens (e.g. "quarterly")' }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: 'Label is required' }, { status: 400 });
  }
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
  }
  if (!Number.isInteger(months) || months <= 0) {
    return NextResponse.json({ error: 'Months must be a positive whole number' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: dbError } = await admin.from('plan_tiers').insert({
    id,
    label,
    amount_naira: amountNaira,
    months,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
  });

  if (dbError) {
    return NextResponse.json({ error: dbError.code === '23505' ? 'A plan with that id already exists' : dbError.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
