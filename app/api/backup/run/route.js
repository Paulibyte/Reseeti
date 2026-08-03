import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { PROVIDERS, refreshAccessToken, uploadBackupFile } from '../../../../lib/cloudBackup';
import { buildBackupPayload, backupFilename } from '../../../../lib/backupExport';
import { encrypt, decrypt } from '../../../../lib/crypto';

export const dynamic = 'force-dynamic';

// Shared by both triggers below — refreshes the access token first if it
// looks expired (or is about to, within a minute, to avoid a race where
// the upload call itself lands just past expiry), generates a fresh
// export, uploads it, and records the result either way so
// app/dashboard/backups/page.js has something honest to show
// ("last backup: 2 hours ago" vs. "last backup failed: <reason>").
async function runOneBackup(admin, connection, business) {
  try {
    let accessToken = decrypt(connection.access_token);

    const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
    const needsRefresh = expiresAt && expiresAt < Date.now() + 60_000;

    if (needsRefresh) {
      if (!connection.refresh_token) {
        throw new Error('This connection has no refresh token on file — please reconnect it.');
      }
      const refreshed = await refreshAccessToken(connection.provider, decrypt(connection.refresh_token));
      accessToken = refreshed.accessToken;
      await admin.from('cloud_backup_connections').update({
        access_token: encrypt(refreshed.accessToken),
        refresh_token: encrypt(refreshed.refreshToken),
        expires_at: refreshed.expiresAt,
      }).eq('id', connection.id);
    }

    const payload = await buildBackupPayload(admin, business);
    await uploadBackupFile(connection.provider, accessToken, backupFilename(business.name), payload);

    await admin.from('cloud_backup_connections').update({
      last_backup_at: new Date().toISOString(),
      last_backup_status: 'success',
      last_backup_error: null,
    }).eq('id', connection.id);

    return { ok: true };
  } catch (err) {
    await admin.from('cloud_backup_connections').update({
      last_backup_at: new Date().toISOString(),
      last_backup_status: 'failed',
      last_backup_error: err.message,
    }).eq('id', connection.id);
    return { ok: false, error: err.message };
  }
}

// POST — "Backup now" button for one specific provider, business owner
// only, scoped to their own business/connection via the normal
// membership lookup.
export async function POST(request) {
  const { provider } = await request.json();
  if (!PROVIDERS[provider]) {
    return NextResponse.json({ error: 'Unknown backup provider' }, { status: 404 });
  }

  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }
  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only the business owner can run a backup.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from('cloud_backup_connections')
    .select('*')
    .eq('business_id', membership.businessId)
    .eq('provider', provider)
    .single();

  if (!connection) {
    return NextResponse.json({ error: `${PROVIDERS[provider].label} isn't connected yet.` }, { status: 400 });
  }

  const { data: business } = await admin.from('businesses').select('*').eq('id', membership.businessId).single();
  const result = await runOneBackup(admin, connection, business);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// GET — daily scheduled backup across every connected business/provider
// (see vercel.json). Same CRON_SECRET protection as the reminders cron —
// see README_STAGE16.md.
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: connections } = await admin.from('cloud_backup_connections').select('*');

  const businessCache = new Map();
  let succeeded = 0, failed = 0;

  for (const connection of connections || []) {
    if (!businessCache.has(connection.business_id)) {
      const { data: biz } = await admin.from('businesses').select('*').eq('id', connection.business_id).single();
      businessCache.set(connection.business_id, biz);
    }
    const business = businessCache.get(connection.business_id);
    if (!business) continue;

    const result = await runOneBackup(admin, connection, business);
    if (result.ok) succeeded++; else failed++;
  }

  return NextResponse.json({ connections: (connections || []).length, succeeded, failed });
}
