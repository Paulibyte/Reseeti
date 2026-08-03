'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '../../lib/supabaseClient';

const NAV_ITEMS = [
  { href: '/admin', label: 'Overview', icon: '📊' },
  { href: '/admin/businesses', label: 'Businesses', icon: '🏢' },
  { href: '/admin/admins', label: 'Admins', icon: '🔑' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️' },
];

export default function AdminNav({ label }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <nav style={{ width: 210, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', padding: '22px 14px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0 8px', marginBottom: 22 }}>
        <p style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontWeight: 700, fontSize: 15, margin: 0 }}>Reseeti Admin</p>
        {label && <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '2px 0 0' }}>{label}</p>}
      </div>

      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: 6,
              fontSize: 13.5, fontWeight: active ? 700 : 500, textDecoration: 'none', marginBottom: 2,
              color: active ? 'var(--heading)' : 'var(--text-muted)',
              background: active ? 'var(--orange-bg)' : 'transparent',
            }}
          >
            <span style={{ fontSize: 14 }}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}

      <div style={{ flex: 1 }} />

      <Link href="/dashboard" style={{ fontSize: 12, color: 'var(--text-faint)', padding: '0 10px', marginBottom: 10, textDecoration: 'none' }}>
        ← Back to my dashboard
      </Link>
      <button
        onClick={signOut}
        style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '8px 10px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
      >
        Sign out
      </button>
    </nav>
  );
}
