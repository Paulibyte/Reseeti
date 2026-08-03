import { createClient } from './supabaseClient';

// Deliberately minimal: no third-party analytics account to set up, no
// script to load from an external domain (which also means no extra
// privacy/consent conversation to have with users). Events land in your
// own Supabase `events` table — query them directly in the SQL editor,
// or wire up a dashboard later once you know which questions you
// actually want answered.
//
// Fire-and-forget by design: analytics must never block or break the
// action it's measuring. If this fails, it fails silently.
export async function track(eventType, metadata = {}) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('events').insert({
      event_type: eventType,
      user_id: user?.id ?? null,
      metadata,
    });
  } catch {
    // Swallow errors on purpose — e.g. offline. Analytics is not
    // allowed to be the reason a real user action fails.
  }
}
