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
  // getSession() reads from local storage — no network round trip — so
  // this stays correct even with no real connectivity. getUser() looks
  // similar but always makes a live request to re-verify the session
  // with Supabase's server; when that request fails (offline, or just a
  // weak connection), it returns no user at all, which every page here
  // reads as "not signed in" and redirects to /login. For an app built
  // to let people keep working offline (see lib/offlineQueue.js), that
  // network-dependent check was actively working against the rest of
  // the design — a real session sitting safely in local storage getting
  // treated as logged-out purely because a verification ping timed out.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user ?? null;
  if (!user) return { user: null, business: null, role: null, overrides: {} };

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
