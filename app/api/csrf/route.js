import { NextResponse } from 'next/server';
import { CSRF_COOKIE_NAME, generateCsrfToken } from '../../../lib/csrf';

export const dynamic = 'force-dynamic';

// GET /api/csrf — called once when the app shell loads (see
// app/RegisterSW.jsx) purely to make sure the CSRF cookie exists before
// the person does anything that needs it. Doesn't require a signed-in
// session — the cookie itself is just a random value, meaningless
// without a matching signed-in session on the routes that check it.
export async function GET(request) {
  const existing = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const token = existing || generateCsrfToken();

  const response = NextResponse.json({ ok: true });
  if (!existing) {
    response.cookies.set(CSRF_COOKIE_NAME, token, {
      httpOnly: false, // must be readable by client JS — see lib/csrf.js
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days — this token doesn't need to be short-lived, it's not a credential on its own
      path: '/',
    });
  }
  return response;
}
