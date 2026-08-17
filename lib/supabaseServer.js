import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function createRouteClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: (name, value, options) => cookieStore.set({ name, value, ...options }),
        remove: (name, options) => cookieStore.set({ name, value: '', ...options }),
      },
    }
  );
}

// Server-side counterpart to lib/getMyBusiness.js — used by API routes
// (payment initialize/history endpoints) rather than page components.
// Same resolution logic, kept as a separate function because route
// handlers use createRouteClient() (cookie-based) rather than the browser
// client, and because routes only need the IDs, not the full nested
// business object a page renders.
//
// Stage 43: same multi-business fix as getMyBusiness.js — picks the
// person's currently-active business (via user_metadata.active_business_id,
// falling back to their first membership) rather than assuming there's
// only ever one. getUser() (not getSession()) is correct and unchanged
// here specifically: this runs server-side in an API route, which
// always has real connectivity to Supabase, so there's no offline
// concern the way there is for client-side page loads.
export async function getMyBusinessId(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase
    .from('business_members')
    .select('business_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active');

  const list = memberships || [];
  if (list.length === 0) return null;

  const activeId = user.user_metadata?.active_business_id;
  const current = list.find((m) => m.business_id === activeId) || list[0];

  return { userId: user.id, businessId: current.business_id, role: current.role };
}
