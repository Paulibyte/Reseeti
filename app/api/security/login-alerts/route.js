import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { verifyCsrfToken } from '../../../../lib/csrf';

export const dynamic = 'force-dynamic';

// business_members' own RLS (Stage 18) only lets an owner or manager
// update a member row — reasonable for role/status changes, but it means
// a staff member can't toggle their own login_alerts_enabled preference
// through a normal client-side Supabase call. This route exists
// specifically to make that one exception: the admin client bypasses
// RLS, but the WHERE clause below still only ever touches the caller's
// own row (user_id = the signed-in user, taken from their own session,
// never from the request body) — nobody can use this to change anyone
// else's setting.
export async function POST(request) {
  if (!verifyCsrfToken(request)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { enabled } = await request.json();

  const admin = createAdminClient();
  const { error } = await admin
    .from('business_members')
    .update({ login_alerts_enabled: !!enabled })
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
