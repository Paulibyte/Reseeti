import { createAdminClient } from '../../../lib/supabaseAdmin';
import SettingsForm from './SettingsForm';

export const dynamic = 'force-dynamic';

export default async function AdminSettingsPage() {
  const supabase = createAdminClient();
  const { data: settings } = await supabase.from('platform_settings').select('*').single();

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 6px' }}>
        Settings
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>
        Platform-wide defaults. Individual businesses can still be overridden from their own page under Businesses.
      </p>
      <SettingsForm settings={settings} />
    </div>
  );
}
