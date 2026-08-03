import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createRouteClient, getMyBusinessId } from '../../../../../lib/supabaseServer';
import { PROVIDERS, buildAuthUrl, isProviderConfigured } from '../../../../../lib/cloudBackup';

export const dynamic = 'force-dynamic';

// GET /api/backup/{google|dropbox|onedrive}/connect — clicked from
// app/dashboard/backups/page.js's "Connect" button. Kicks off the OAuth
// dance by redirecting the browser to the provider's own consent screen;
// the provider redirects back to .../callback (sibling route) once the
// business owner approves access.
export async function GET(request, { params }) {
  const provider = params.provider;
  if (!PROVIDERS[provider]) {
    return NextResponse.json({ error: 'Unknown backup provider' }, { status: 404 });
  }
  if (!isProviderConfigured(provider)) {
    return NextResponse.json({ error: `${PROVIDERS[provider].label} isn't configured on this server yet — see README_STAGE24.md.` }, { status: 501 });
  }

  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }
  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only the business owner can connect a backup destination.' }, { status: 403 });
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/backup/${provider}/callback`;

  // A random nonce, round-tripped through the provider's own redirect and
  // checked again on the way back (see callback/route.js) — standard
  // OAuth CSRF protection, stopping a third party from tricking someone
  // into linking an attacker-controlled Drive/Dropbox/OneDrive account to
  // their Reseeti business via a crafted callback URL.
  const state = crypto.randomBytes(24).toString('hex');
  const authUrl = buildAuthUrl(provider, redirectUri, state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(`reseeti_oauth_state_${provider}`, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes — plenty of time to approve a consent screen
    path: '/',
  });
  return response;
}
