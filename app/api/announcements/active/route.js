import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
// See receipt-data/route.js's comment on this exact pair of settings —
// dynamic alone isn't sufficient for the createAdminClient() read
// below to always be fresh; this is the separate setting that actually
// guarantees it.
export const fetchCache = 'force-no-store';

// One announcement at a time, most recent first — if the admin has
// several active at once, only the newest one shows; older ones stay
// in the admin list but simply don't surface until this one is
// deactivated. Filtered to 'all' plus whichever plan this specific
// business is actually on, so a free-plan upgrade promo never shows to
// a business that's already Pro, and vice versa.
export async function GET() {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ announcement: null });
  }

  const admin = createAdminClient();
  const { data: business } = await admin
    .from('businesses')
    .select('plan')
    .eq('id', membership.businessId)
    .single();

  const plan = business?.plan === 'pro' ? 'pro' : 'free';

  const { data } = await admin
    .from('platform_announcements')
    .select('id, title, message, cta_label, cta_url, target_plan, created_at')
    .eq('active', true)
    .in('target_plan', ['all', plan])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ announcement: data || null });
}
