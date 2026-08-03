import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../../lib/supabaseAdmin';
import { createRouteClient, getMyBusinessId } from '../../../../../lib/supabaseServer';
import { PROVIDERS, exchangeCodeForTokens } from '../../../../../lib/cloudBackup';
import { encrypt } from '../../../../../lib/crypto';

export const dynamic = 'force-dynamic';

// GET /api/backup/{google|dropbox|onedrive}/callback — where the
// provider redirects back to after the business owner approves (or
// denies) access on their consent screen. Not something anyone clicks
// directly; the whole point of connect/route.js's redirect is to land
// here with a `code` this route can exchange for real tokens.
export async function GET(request, { params }) {
  const provider = params.provider;
  const backupsUrl = new URL('/dashboard/backups', process.env.NEXT_PUBLIC_APP_URL);

  if (!PROVIDERS[provider]) {
    return NextResponse.json({ error: 'Unknown backup provider' }, { status: 404 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const expectedState = request.cookies.get(`reseeti_oauth_state_${provider}`)?.value;

  if (oauthError) {
    backupsUrl.searchParams.set('error', `${PROVIDERS[provider].label} sign-in was cancelled or denied.`);
    return NextResponse.redirect(backupsUrl);
  }
  if (!code || !returnedState || returnedState !== expectedState) {
    backupsUrl.searchParams.set('error', 'That connection link expired or was invalid — please try Connect again.');
    return NextResponse.redirect(backupsUrl);
  }

  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    // The Supabase auth cookie should still be present — this app's own
    // session cookie isn't touched by the round trip through Google/
    // Dropbox/Microsoft's domains — but if it's somehow gone, sending the
    // person to log back in beats a confusing failure deep in an OAuth
    // flow they can't retry from here.
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL));
  }

  try {
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/backup/${provider}/callback`;
    const tokens = await exchangeCodeForTokens(provider, code, redirectUri);

    const admin = createAdminClient();
    await admin.from('cloud_backup_connections').upsert({
      business_id: membership.businessId,
      provider,
      access_token: encrypt(tokens.accessToken),
      refresh_token: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      expires_at: tokens.expiresAt,
      connected_at: new Date().toISOString(),
      last_backup_status: null,
      last_backup_error: null,
    }, { onConflict: 'business_id,provider' });

    backupsUrl.searchParams.set('connected', provider);
  } catch (err) {
    console.error(`${provider} OAuth callback failed:`, err);
    backupsUrl.searchParams.set('error', `Could not finish connecting ${PROVIDERS[provider].label}. Please try again.`);
  }

  const response = NextResponse.redirect(backupsUrl);
  response.cookies.delete(`reseeti_oauth_state_${provider}`);
  return response;
}
