import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { PROVIDERS } from '../../../../lib/cloudBackup';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const { provider } = await request.json();
  if (!PROVIDERS[provider]) {
    return NextResponse.json({ error: 'Unknown backup provider' }, { status: 404 });
  }

  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }
  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only the business owner can disconnect a backup destination.' }, { status: 403 });
  }

  // Deletes the row entirely rather than just marking it inactive —
  // once disconnected, the encrypted tokens serve no purpose and
  // shouldn't linger in the database. Reconnecting later is a fresh
  // OAuth flow either way.
  const admin = createAdminClient();
  await admin
    .from('cloud_backup_connections')
    .delete()
    .eq('business_id', membership.businessId)
    .eq('provider', provider);

  return NextResponse.json({ ok: true });
}
