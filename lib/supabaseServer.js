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
export async function getMyBusinessId(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from('business_members')
    .select('business_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  if (!membership) return null;
  return { userId: user.id, businessId: membership.business_id, role: membership.role };
}
