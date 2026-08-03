import { createAdminClient } from '../../../lib/supabaseAdmin';
import { requirePlatformAdmin } from '../../../lib/getPlatformAdmin';
import AdminsManager from './AdminsManager';

export const dynamic = 'force-dynamic';

export default async function AdminAdminsPage() {
  const me = await requirePlatformAdmin();
  const supabase = createAdminClient();

  const { data: admins } = await supabase
    .from('platform_admins')
    .select('user_id, label, created_at')
    .order('created_at', { ascending: true });

  // auth.users isn't exposed via the normal postgrest API, so each
  // admin's phone/email (for display only) is looked up individually via
  // the Auth admin API — fine at the "small team" scale this is meant
  // for; would want a different approach if this list ever grew large.
  const withContact = await Promise.all(
    (admins || []).map(async (a) => {
      const { data } = await supabase.auth.admin.getUserById(a.user_id);
      return { ...a, phone: data?.user?.phone || null, email: data?.user?.email || null };
    })
  );

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 6px' }}>
        Admins
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>
        Anyone listed here can access this entire panel — only add people you trust with full platform access.
      </p>
      <AdminsManager admins={withContact} myUserId={me.userId} />
    </div>
  );
}
