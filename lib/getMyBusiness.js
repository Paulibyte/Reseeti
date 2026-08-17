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
//
// Stage 43 (multi-business support): a person can now belong to more
// than one business — accepting a second invite while keeping their own
// existing one, for instance — so this no longer assumes exactly one
// active membership. `business`/`role`/`overrides` below are always the
// one CURRENTLY ACTIVE business (every existing call site — 30+ pages —
// keeps working completely unchanged), chosen by matching
// user_metadata.active_business_id against their real memberships, and
// falling back to the first one if that's unset or no longer valid (e.g.
// they were removed from whichever business they'd last switched to).
// The full list is returned too, as `businesses`, for the new
// BusinessSwitcher — nothing reads that unless it needs to.
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
  if (!user) return { user: null, business: null, role: null, overrides: {}, businesses: [] };

  const { data: memberships } = await supabase
    .from('business_members')
    .select('role, permission_overrides, business:businesses(*)')
    .eq('user_id', user.id)
    .eq('status', 'active');

  const list = memberships || [];
  const activeId = user.user_metadata?.active_business_id;
  const current = list.find((m) => m.business?.id === activeId) || list[0] || null;

  return {
    user,
    business: current?.business ?? null,
    role: current?.role ?? null,
    // Sparse per-permission overrides (Stage 28) — pass straight through
    // to can()/permissionsFor() as the third argument. Empty object (not
    // null/undefined) when there are none, so callers can spread/read it
    // without a null check.
    overrides: current?.permission_overrides ?? {},
    // Every business this person belongs to, for the switcher — id/name/
    // role only, not the full row, since nothing needs more than that to
    // render a switcher list.
    businesses: list.map((m) => ({ id: m.business.id, name: m.business.name, role: m.role })),
  };
}

