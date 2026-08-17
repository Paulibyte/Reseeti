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
    .select('id, phone, status, user_id, business_id, business:businesses(name)')
    .eq('id', membershipId)
    .maybeSingle();

  if (!invite || invite.status !== 'invited' || invite.user_id) {
    return NextResponse.json({ error: 'This invite is no longer available.' }, { status: 404 });
  }
  // The one security check that actually matters here: this invite's
  // phone must be the caller's OWN phone, from their session — never
  // trust a client-supplied phone for this. Without this check, anyone
  // signed in could accept anyone else's pending invite by guessing or
  // enumerating membershipId values.
  if (invite.phone !== user.phone) {
    return NextResponse.json({ error: 'This invite is addressed to a different phone number.' }, { status: 403 });
  }

  const { error } = await admin
    .from('business_members')
    .update({ user_id: user.id, status: 'active', joined_at: new Date().toISOString() })
    .eq('id', membershipId)
    .select('business_id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Switch them into the business they just joined immediately, rather
  // than leaving them on whatever business happened to be active
  // before — same mechanism the BusinessSwitcher uses (plain user
  // metadata; lib/getMyBusiness.js reads this to decide which
  // membership is "current").
  await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, active_business_id: invite.business_id },
  });

  return NextResponse.json({ ok: true, businessName: invite.business?.name || 'the business' });
}
