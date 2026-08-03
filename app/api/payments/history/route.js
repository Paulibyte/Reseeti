import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';

// payment_events is written only by the payment gateway webhooks using the
// service-role key, and deliberately has no client-facing RLS policy (see
// schema_stage2.sql). So this route authenticates the caller with their
// normal session first, resolves *their business* via membership (any
// active member — owner or staff, since viewing billing history isn't a
// billing action the way starting a subscription is), and only then uses
// the admin client — scoped to that one business_id — to read back the
// transaction log. The client never gets unscoped admin access.
export async function GET() {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: events, error } = await admin
    .from('payment_events')
    .select('id, event_type, reference, amount, created_at')
    .eq('business_id', membership.businessId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ events: events || [] });
}
