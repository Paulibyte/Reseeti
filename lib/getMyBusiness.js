// Resolves "which business does the signed-in user belong to, and in what
// role" via business_members — the membership table introduced in Stage 8.
//
// Before Stage 8, every dashboard page queried
// `.from('businesses').eq('user_id', user.id).single()` directly, because
// a user WAS a business (one-to-one). Staff accounts break that: several
// users can now belong to the same business. This helper is the one
// place that lookup logic lives, so every page resolves membership the
// same way instead of each having its own (and potentially inconsistent)
// copy of the query.
export async function getMyBusiness(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, business: null, role: null };

  const { data: membership } = await supabase
    .from('business_members')
    .select('role, permission_overrides, business:businesses(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  return {
    user,
    business: membership?.business ?? null,
    role: membership?.role ?? null,
    // Sparse per-permission overrides (Stage 28) — pass straight through
    // to can()/permissionsFor() as the third argument. Empty object (not
    // null/undefined) when there are none, so callers can spread/read it
    // without a null check.
    overrides: membership?.permission_overrides ?? {},
  };
}
