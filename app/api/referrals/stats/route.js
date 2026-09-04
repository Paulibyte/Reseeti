import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
// See receipt-data/route.js's comment on this exact pair of settings —
// dynamic alone isn't sufficient for the createAdminClient() reads
// below to always be fresh; this is the separate setting that actually
// guarantees it.
export const fetchCache = 'force-no-store';

export async function GET() {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: business } = await admin
    .from('businesses')
    .select('available_referral_discounts')
    .eq('id', membership.businessId)
    .single();

  const { data: referrals } = await admin
    .from('referrals')
    .select('status')
    .eq('referrer_business_id', membership.businessId);

  const total = (referrals || []).length;
  const qualified = (referrals || []).filter((r) => r.status === 'qualified').length;

  return NextResponse.json({
    businessId: membership.businessId,
    totalReferred: total,
    qualified,
    availableDiscounts: business?.available_referral_discounts || 0,
  });
}
