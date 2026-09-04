import { createAdminClient } from '../../../lib/supabaseAdmin';
import SettingsForm from './SettingsForm';
import AnnouncementsManager from './AnnouncementsManager';

export const dynamic = 'force-dynamic';
// See app/api/invoices/[id]/receipt-data/route.js's own comment on this
// exact setting for the full explanation — dynamic alone controls
// whether Next.js treats this PAGE as static or dynamic; fetchCache is
// the separate setting controlling whether the individual database
// reads made from WITHIN this page (via createAdminClient/supabase-js)
// get cached, independent of that. Without this, the very first time
// this page loaded — quite possibly before any announcement had ever
// been created — Next.js could cache that empty result and keep
// serving it indefinitely, regardless of what's actually since been
// added to the table.
export const fetchCache = 'force-no-store';

export default async function AdminSettingsPage() {
  const supabase = createAdminClient();
  const { data: settings } = await supabase.from('platform_settings').select('*').single();
  const { data: announcements } = await supabase
    .from('platform_announcements')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 6px' }}>
        Settings
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>
        Platform-wide defaults. Individual businesses can still be overridden from their own page under Businesses.
      </p>
      <SettingsForm settings={settings} />
      <AnnouncementsManager announcements={announcements || []} />
    </div>
  );
}
