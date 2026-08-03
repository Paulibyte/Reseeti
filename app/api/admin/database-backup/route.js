import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// Distinct from Stage 24's cloud backups: that feature exports ONE
// business's own data to THAT business's own Google Drive/Dropbox/
// OneDrive, triggered per-business, and only for businesses that opted
// in by connecting an account. This is a platform-wide, operator-level
// safety net — every business, every table, on a fixed schedule,
// stored in Reseeti's own private Supabase Storage bucket rather than
// anyone's personal cloud account.
//
// IMPORTANT — what this is and isn't: this is a logical (row-level JSON)
// export via the same admin client every other cron in this app uses,
// not a true binary pg_dump / WAL-level backup. It's a genuine safety
// net (a bad migration, an accidental bulk delete, a bug that corrupts
// data) but it does NOT replace Supabase's own built-in automated
// backups and point-in-time recovery, which operate at the database
// engine level and can restore to any point in time, not just to
// whenever this cron last ran. See README_STAGE27.md — turn on
// Supabase's own backups (Project Settings → Database → Backups) as the
// primary safety net; treat this as a secondary, app-level one.
const BUCKET = process.env.DATABASE_BACKUP_BUCKET || 'platform-backups';
const RETENTION_DAYS = 30;

// Every table with real business data. Deliberately excludes:
// - cloud_backup_connections' access_token/refresh_token columns (only
//   non-sensitive columns are pulled) — those are already encrypted at
//   rest (lib/crypto.js); duplicating them into a second file, however
//   private the bucket, is unnecessary exposure surface for no real
//   backup value (a lost OAuth connection is reconnected, not restored).
// - rate_limits (purely ephemeral abuse-prevention counters, not data
//   anyone would ever want restored).
// - schema_migrations (meta-information about the schema itself, not
//   business data — already fully captured in the supabase/*.sql files
//   in source control).
const TABLES = [
  'businesses', 'business_members', 'customers', 'products',
  'invoices', 'invoice_items', 'expenses', 'payment_events', 'events',
  'feedback', 'user_devices', 'cloud_backup_connections',
];

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const dump = { generated_at: new Date().toISOString(), tables: {} };
  const errors = [];

  for (const table of TABLES) {
    const query = table === 'cloud_backup_connections'
      ? admin.from(table).select('id, business_id, provider, connected_at, last_backup_at, last_backup_status')
      : admin.from(table).select('*');

    const { data, error } = await query;
    if (error) {
      errors.push({ table, error: error.message });
      continue;
    }
    dump.tables[table] = data || [];
  }

  const filename = `db-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const content = JSON.stringify(dump, null, 2);

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(filename, content, { contentType: 'application/json', upsert: true });

  if (uploadError) {
    return NextResponse.json({ error: `Backup upload failed: ${uploadError.message}`, tableErrors: errors }, { status: 500 });
  }

  // Retention: delete backups older than RETENTION_DAYS rather than
  // keeping every daily export forever — a private Storage bucket still
  // costs storage space and gains nothing from a 400th daily snapshot of
  // a small business's data once there are 30 more recent ones to
  // restore from instead.
  const { data: existing } = await admin.storage.from(BUCKET).list();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const stale = (existing || []).filter((f) => {
    const match = /^db-backup-(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name);
    return match && new Date(match[1]).getTime() < cutoff;
  });
  if (stale.length > 0) {
    await admin.storage.from(BUCKET).remove(stale.map((f) => f.name));
  }

  return NextResponse.json({
    ok: true,
    filename,
    tablesBackedUp: Object.keys(dump.tables).length,
    tableErrors: errors,
    deletedStale: stale.length,
  });
}
