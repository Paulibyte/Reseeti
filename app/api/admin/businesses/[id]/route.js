import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../../lib/supabaseAdmin';
import { isPlatformAdmin } from '../../../../../lib/isPlatformAdmin';
import { verifyCsrfToken } from '../../../../../lib/csrf';

const ALLOWED_FIELDS = ['plan', 'monthly_invoice_limit', 'plan_renews_at', 'plan_grace_until'];

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

  if ('plan' in body) {
    if (body.plan !== 'free' && body.plan !== 'pro') {
      return NextResponse.json({ error: "plan must be 'free' or 'pro'" }, { status: 400 });
    }
    updates.plan = body.plan;
  }

  if ('monthly_invoice_limit' in body) {
    // null clears the override and falls back to the platform default —
    // same "coalesce down to platform_settings" behavior the enforcement
    // trigger already implements (schema_stage26.sql).
    if (body.monthly_invoice_limit !== null) {
      const n = Number(body.monthly_invoice_limit);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json({ error: 'monthly_invoice_limit must be a whole number, 0 or more, or null' }, { status: 400 });
      }
      updates.monthly_invoice_limit = n;
    } else {
      updates.monthly_invoice_limit = null;
    }
  }

  if ('plan_renews_at' in body) {
    updates.plan_renews_at = body.plan_renews_at || null;
  }

  if ('plan_grace_until' in body) {
    updates.plan_grace_until = body.plan_grace_until || null;
  }

  const unknownField = Object.keys(body).find((k) => !ALLOWED_FIELDS.includes(k));
  if (unknownField) {
    return NextResponse.json({ error: `Unknown field: ${unknownField}` }, { status: 400 });
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No recognized fields in request body' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('businesses')
    .update(updates)
    .eq('id', params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
