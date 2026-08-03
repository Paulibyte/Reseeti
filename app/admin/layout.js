import { redirect } from 'next/navigation';
import { requirePlatformAdmin } from '../../lib/getPlatformAdmin';
import AdminNav from './AdminNav';

// Security-sensitive check — must run fresh on every request, never a
// cached snapshot (see the receipt-page caching bug this app already hit
// once for why this matters).
export const dynamic = 'force-dynamic';

// Every /admin/* page shares this layout, so the auth check only needs to
// live in one place. Anyone not signed in, or signed in but not listed in
// platform_admins, gets bounced to the normal login page — there's no
// "access denied" page shown, since revealing that /admin exists at all
// to a non-admin isn't useful information to give them either way.
export default async function AdminLayout({ children }) {
  const admin = await requirePlatformAdmin();
  if (!admin) redirect('/login');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <AdminNav label={admin.label} />
      <main style={{ flex: 1, padding: '28px 32px', maxWidth: 1100 }}>
        {children}
      </main>
    </div>
  );
}
