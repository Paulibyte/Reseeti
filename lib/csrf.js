// Double-submit cookie pattern: a random token is set as a readable
// (non-httpOnly) cookie, and every mutating request must echo that same
// value back in a header. A cross-site attacker's forged form/fetch can
// send the cookie automatically (that's what cookies do) but can't read
// its value to also attach the matching header — same-origin JS is the
// only thing that can do that. Applied to this app's own API routes that
// authenticate via the Supabase session cookie (createRouteClient) and
// perform a mutation; routes authenticated via a Bearer/JWT header
// instead (the normal Supabase client SDK calls the rest of this app
// makes directly to Supabase's REST API) don't need this — a forged
// cross-site request has no way to attach an Authorization header either.
//
// This is deliberately simpler than it could be: Supabase's own session
// cookie is already SameSite=Lax (see lib/supabaseServer.js), which
// already blocks the cookie from being sent on a cross-site POST at all
// in most browsers — this is a second, independent layer on top of that,
// not a replacement for it, and matters most for older/misconfigured
// browsers or any future change to the cookie's SameSite setting.

import crypto from 'crypto';

export const CSRF_COOKIE_NAME = 'reseeti_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

export function generateCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Returns true/false — never throws, so callers can respond with a plain
// 403 rather than a 500 on a missing/mismatched token.
export function verifyCsrfToken(request) {
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  if (!cookieToken || !headerToken) return false;
  // Constant-time comparison — same reasoning as the webhook signature
  // hardening elsewhere in this stage: a naive === comparison leaks
  // timing information about how many leading bytes matched, which is a
  // (admittedly hard to exploit remotely, but real) side channel.
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
