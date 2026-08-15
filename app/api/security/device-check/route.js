import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { rateLimit, requestIp } from '../../../../lib/rateLimit';
import { verifyCsrfToken } from '../../../../lib/csrf';

export const dynamic = 'force-dynamic';

// Called by app/login/page.js right after supabase.auth.signInWithPassword()
// succeeds — by then a real session already exists (see that file's
// comments on why this is a client-side speed bump, not a database-
// enforced barrier), so this can identify the caller normally. Purely a
// read: does NOT upsert into user_devices, send an alert, or write an
// audit event — that all still happens exactly as before, in
// /api/security/login-event, once login actually finishes (either
// immediately, for a recognized device, or after the OTP step-up this
// route triggers for an unrecognized one).
export async function POST(request) {
  if (!verifyCsrfToken(request)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { allowed } = await rateLimit(`device-check:${requestIp(request)}`, { limit: 30, windowSeconds: 3600 });
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { deviceId } = await request.json();
  if (!deviceId) {
    return NextResponse.json({ error: 'Missing deviceId' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existingDevice } = await admin
    .from('user_devices')
    .select('id')
    .eq('user_id', user.id)
    .eq('device_id', deviceId)
    .maybeSingle();

  return NextResponse.json({ isNewDevice: !existingDevice });
}
