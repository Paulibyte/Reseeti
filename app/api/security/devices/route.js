import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../lib/supabaseServer';

export const dynamic = 'force-dynamic';

// GET — the Security page's device list. Uses the caller's own session
// client directly (not the admin client) since user_devices' RLS policy
// already scopes rows to auth.uid() = user_id — no extra business-lookup
// needed, this is a per-USER list, not a per-business one (a shared
// business account with several staff members each has their own device
// list, since each staff member signs in with their own phone number).
export async function GET() {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('user_devices')
    .select('device_id, label, user_agent, first_seen_at, last_seen_at')
    .order('last_seen_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ devices: data || [] });
}
