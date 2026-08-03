import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';

export const dynamic = 'force-dynamic';

// A plain `select('*')` from the client against cloud_backup_connections
// would technically be blocked from other businesses' rows by RLS, but
// would still hand this business's own encrypted access_token/
// refresh_token strings to the browser for no reason — RLS controls
// which rows a query can see, not which columns. This route exists so
// app/dashboard/backups/page.js only ever gets the handful of fields it
// actually needs to render connection status.
export async function GET() {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from('cloud_backup_connections')
    .select('provider, connected_at, last_backup_at, last_backup_status, last_backup_error')
    .eq('business_id', membership.businessId);

  return NextResponse.json({ connections: data || [] });
}
