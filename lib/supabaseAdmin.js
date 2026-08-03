import { createClient } from '@supabase/supabase-js';

// IMPORTANT: this uses the service_role key, which bypasses row-level
// security entirely. Never import this file into client-side code — it
// must only run in API routes / server code. Get the key from Supabase:
// Project Settings > API > service_role (secret).
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}
