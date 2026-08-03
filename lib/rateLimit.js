// Vercel's serverless functions don't share memory between invocations
// (and often run across several concurrent instances even for "the same"
// endpoint), so an in-memory Map-based limiter would silently do nothing
// useful in production — each cold start/instance would have its own
// empty counter. This uses the increment_rate_limit() Postgres function
// (schema_stage25.sql) instead, so the count is real and shared no
// matter which serverless instance handles a given request.
//
// SERVER-ONLY — imported only from app/api/*/route.js handlers.

import { createAdminClient } from './supabaseAdmin';

// Returns { allowed, remaining }. On any unexpected error (Postgres
// unreachable, etc.) this fails OPEN (allowed: true) rather than closed —
// a rate limiter that itself takes down the app during a database hiccup
// would be a worse outcome than occasionally missing a would-be-blocked
// abusive request.
export async function rateLimit(key, { limit, windowSeconds }) {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('increment_rate_limit', {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_max_count: limit,
    });
    if (error) throw error;
    const row = data?.[0];
    return { allowed: row?.allowed ?? true, remaining: Math.max(0, limit - (row?.current_count ?? 0)) };
  } catch (err) {
    console.error('Rate limit check failed (failing open):', err);
    return { allowed: true, remaining: limit };
  }
}

// Best-effort caller identity for rate-limit keys on routes that don't
// have a signed-in business yet (e.g. right after login). Vercel sets
// x-forwarded-for on every request; falls back to a constant so at least
// same-deployment traffic still shares one bucket rather than throwing.
export function requestIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}
