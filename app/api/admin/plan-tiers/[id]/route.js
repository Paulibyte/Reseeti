import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../../lib/supabaseAdmin';
import { isPlatformAdmin } from '../../../../../lib/isPlatformAdmin';
import { verifyCsrfToken } from '../../../../../lib/csrf';

const ALLOWED_FIELDS = ['label', 'amount_naira', 'months', 'active', 'sort_order'];

// Deliberately no way to change a tier's id, and no delete endpoint —
// existing businesses.plan_interval values and in-flight checkouts may
// already reference this id, so retiring a tier means setting
// active=false (it stops showing in the UpgradeModal and can no longer
// be paid for), not erasing the row a historical subscription still
// points to.
export async function POST(req, { params }) {
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
  const updates = {};

  if ('label' in body) {
    const label = String(body.label || '').trim();
    if (!label) return NextResponse.json({ error: 'Label cannot be empty' }, { status: 400 });
    updates.label = label;
  }
  if ('amount_naira' in body) {
    const n = Number(body.amount_naira);
    if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
    updates.amount_naira = n;
  }
  if ('months' in body) {
    const n = Number(body.months);
    if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: 'Months must be a positive whole number' }, { status: 400 });
    updates.months = n;
  }
  if ('active' in body) {
    updates.active = !!body.active;
  }
  if ('sort_order' in body) {
    updates.sort_order = Number(body.sort_order) || 0;
  }

  const unknownField = Object.keys(body).find((k) => !ALLOWED_FIELDS.includes(k));
  if (unknownField) {
    return NextResponse.json({ error: `Unknown field: ${unknownField}` }, { status: 400 });
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No recognized fields in request body' }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const admin = createAdminClient();
  const { error } = await admin.from('plan_tiers').update(updates).eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
