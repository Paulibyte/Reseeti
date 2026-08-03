import { createRouteClient } from './supabaseServer';
import { createAdminClient } from './supabaseAdmin';

// Checks whether the currently signed-in user (the same Supabase Auth
// used for business owners/staff) is also listed in platform_admins.
// That table has no client-facing RLS policies at all (see
// schema_stage15.sql), so this check can only be done server-side with
// the admin (service-role) client — nobody can read or forge their way
// into it from the browser, regardless of what they're signed in as.
//
// Server-only: call this from Server Components, layouts, or Route
// Handlers — never from a 'use client' component.
export async function requirePlatformAdmin() {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: adminRow } = await admin
    .from('platform_admins')
    .select('user_id, label')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!adminRow) return null;
  return { userId: user.id, label: adminRow.label };
}
