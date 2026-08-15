import { createAdminClient } from './supabaseAdmin';

// Server-only — every gateway initialize/webhook route calls this
// instead of reading from a hardcoded object (see schema_stage34.sql
// for why: tiers are now admin-configurable from /admin, not baked
// into the code). Returns null for an id that doesn't exist or has
// been deactivated — callers treat that as "invalid tier," same as the
// old isValidTier() check did.
export async function getTier(tierId) {
  if (!tierId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from('plan_tiers')
    .select('id, label, amount_naira, months')
    .eq('id', tierId)
    .eq('active', true)
    .maybeSingle();
  return data;
}

export function renewsAtForMonths(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + (months || 1));
  return d;
}
