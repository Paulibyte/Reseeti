import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../lib/supabaseAdmin';
import { createRouteClient, getMyBusinessId } from '../../../lib/supabaseServer';

export const dynamic = 'force-dynamic';

// The `events` table (Stage 5) was deliberately built with no client
// read access at all — its own migration comment says as much, on the
// assumption the app's operator would query it directly in the Supabase
// dashboard. This route is the considered exception to that: it's
// owner-only, scoped strictly to that owner's own business_id (never
// cross-business), and returns a bounded, paginated slice rather than
// the whole table — reasonable now that there's an actual in-app need
// (the Activity & Audit page) for a business owner to see their own
// history without needing separate Supabase dashboard access.
const SECURITY_EVENT_TYPES = [
  'login_success', 'login_failed', 'mfa_enrolled', 'mfa_unenrolled',
  'mfa_challenge_failed', 'signed_out_everywhere', 'device_forgotten',
];

export async function GET(request) {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }
  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only the business owner can view the activity log.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const tab = url.searchParams.get('tab') === 'security' ? 'security' : 'activity';
  const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
  const pageSize = 30;

  const admin = createAdminClient();
  let query = admin
    .from('events')
    .select('id, event_type, metadata, created_at')
    .eq('business_id', membership.businessId)
    .order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  query = tab === 'security'
    ? query.in('event_type', SECURITY_EVENT_TYPES)
    : query.not('event_type', 'in', `(${SECURITY_EVENT_TYPES.join(',')})`);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ events: data || [], page, hasMore: (data || []).length === pageSize });
}
