import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../../lib/supabaseServer';
import { verifyCsrfToken } from '../../../../../lib/csrf';

export const dynamic = 'force-dynamic';

// DELETE /api/security/devices/{deviceId} — "Forget this device" on the
// Security page. Important to be honest about what this does and
// doesn't do (see schema_stage25.sql's comment on user_devices): it only
// removes the device from this informational list and stops it being
// treated as "known" for login-alert purposes. It does NOT sign that
// device out or revoke its session — Supabase Auth doesn't expose
// per-session revocation to the client, so the real "kick every other
// device out" action is the separate "Sign out of all other devices"
// button, which calls supabase.auth.signOut({ scope: 'others' })
// directly (see app/dashboard/security/page.js).
export async function DELETE(request, { params }) {
  if (!verifyCsrfToken(request)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { error } = await supabase
    .from('user_devices')
    .delete()
    .eq('user_id', user.id)
    .eq('device_id', params.deviceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
