import { createAdminClient } from './supabaseAdmin';

// Server-only — same reasoning as lib/supabaseAdmin.js itself. Must
// never be imported into a 'use client' component, since it pulls in
// the service_role key. Every /api/admin/* route calls this right after
// resolving the caller's user id from their session cookie, before
// doing anything else.
export async function isPlatformAdmin(userId) {
  if (!userId) return false;
  const admin = createAdminClient();
  const { data } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}
