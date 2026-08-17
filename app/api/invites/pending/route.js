import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';

// A pending invite lives in a business the invited person isn't a
// member of yet — by design, "Members can view their team" (Stage 8)
// only lets someone see business_members rows for businesses they
// ALREADY belong to. So this can only ever be answered from the
// service-role client, matching every other cross-boundary lookup in
// this app (isPlatformAdmin, the admin dashboard, etc).
//
// The phone to match on comes from the caller's OWN authenticated
// session (auth.users.phone) — never from a client-supplied value —
// so nobody can query invites addressed to someone else's number.
export async function GET() {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!user.phone) return NextResponse.json({ invites: [] });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('business_members')
    .select('id, role, invited_at, business:businesses(name)')
    .eq('phone', user.phone)
    .eq('status', 'invited')
    .is('user_id', null)
    .order('invited_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    invites: (data || []).map((row) => ({
      id: row.id,
      role: row.role,
      businessName: row.business?.name || 'a business',
      invitedAt: row.invited_at,
    })),
  });
}
