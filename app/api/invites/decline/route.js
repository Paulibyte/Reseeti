import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { verifyCsrfToken } from '../../../../lib/csrf';

export async function POST(req) {
  if (!verifyCsrfToken(req)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { membershipId } = await req.json().catch(() => ({}));
  if (!membershipId) {
    return NextResponse.json({ error: 'Missing membershipId' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from('business_members')
    .select('id, phone, status, user_id')
    .eq('id', membershipId)
    .maybeSingle();

  if (!invite || invite.status !== 'invited' || invite.user_id) {
    return NextResponse.json({ error: 'This invite is no longer available.' }, { status: 404 });
  }
  // Same ownership check as accept — declining someone else's invite
  // isn't dangerous the way accepting one would be, but there's no
  // reason to allow it either.
  if (invite.phone !== user.phone) {
    return NextResponse.json({ error: 'This invite is addressed to a different phone number.' }, { status: 403 });
  }

  // Deleted outright rather than a "declined" status — same as removing
  // a team member elsewhere in the app (team/page.js's removeMember).
  // The owner can send a fresh invite later if this was a mistake.
  const { error } = await admin.from('business_members').delete().eq('id', membershipId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
