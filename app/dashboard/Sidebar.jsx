'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import AppVersion from './AppVersion';
import { can } from '../../lib/permissions';

// Every item maps to the one permission that governs it — Dashboard/
// Invoices has none, since every role lands somewhere and the invoice
// list itself is everyone's home view (individual buttons within it are
// what's actually gated — see dashboard/page.js).
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠', permission: null },
  { href: '/dashboard#invoices', label: 'Invoices', icon: '🧾', permission: null },
  { href: '/dashboard/customers', label: 'Customers', icon: '👥', permission: 'manageCustomers' },
  { href: '/dashboard/inventory', label: 'Inventory', icon: '📦', permission: 'manageInventory' },
  { href: '/dashboard/expenses', label: 'Expenses', icon: '🧾', permission: 'manageExpenses' },
  { href: '/dashboard/cashbook', label: 'Cashbook', icon: '📒', permission: 'manageCashbook' },
  { href: '/dashboard/payments', label: 'Payments', icon: '💳', permission: 'manageSubscription' },
  { href: '/dashboard/analytics', label: 'Analytics', icon: '📊', permission: 'viewAnalytics' },
  { href: '/dashboard/reports', label: 'Reports', icon: '📁', permission: 'viewReports' },
  { href: '/dashboard/team', label: 'Team', icon: '🧑\u200d🤝\u200d🧑', permission: 'manageTeam' },
  { href: '/dashboard/backups', label: 'Backups', icon: '☁️', permission: 'manageSettings' },
  { href: '/dashboard/security', label: 'Security', icon: '🔒', permission: null },
  { href: '/help', label: 'Help & FAQ', icon: '❓', permission: null },
  { href: '/dashboard/activity', label: 'Activity Log', icon: '📜', permission: 'manageSettings' },
  { href: '/dashboard/diagnostics', label: 'Diagnostics', icon: '🛠️', permission: 'manageSettings' },
];

export default function Sidebar({ plan = 'free', role, onUpgradeClick, onSignOut }) {
  const pathname = usePathname();
  const navItems = NAV_ITEMS.filter((item) => !item.permission || can(role, item.permission));

  return (
    <aside
      className="reseeti-sidebar"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 236,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        flexDirection: 'column',
        padding: '22px 0',
        zIndex: 20,
        // The aside itself no longer scrolls — its three children below
        // do their own thing instead: header and footer stay put,
        // and only the middle nav section (the part that actually grows
        // as more pages get added) scrolls. Without this, an 11-item nav
        // plus the upgrade button, theme toggle, and version line simply
        // overflowed past the bottom of shorter viewports with no way to
        // reach the items below the fold.
        overflow: 'hidden',
      }}
    >
      <div style={{ flexShrink: 0, padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Logo size={30} showWordmark style={{ padding: '0 4px' }} />
        </div>
        <span
          style={{
            display: 'inline-block',
            fontSize: 10.5,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: plan === 'pro' ? 'var(--success)' : 'var(--text-faint)',
            background: plan === 'pro' ? 'var(--success-bg)' : 'var(--surface-alt)',
            padding: '3px 8px',
            borderRadius: 10,
            margin: '4px 4px 18px',
          }}
        >
          {plan === 'pro' ? 'Pro Plan' : 'Free Plan'}
        </span>
      </div>

      {/*
        flex: 1 lets this section claim the remaining space between the
        header and footer; minHeight: 0 is the part that's easy to miss —
        without it, a flex child won't actually shrink below its content
        size, which is exactly what was silently pushing this list past
        the bottom of the screen before. overflowY: auto is what turns
        that into a real scrollbar instead.
      */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px' }}>
        {navItems.map((item) => {
          const active = item.href === '/dashboard' ? pathname === '/dashboard' : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                color: active ? 'var(--orange-dark)' : 'var(--text-muted)',
                background: active ? 'var(--orange-bg)' : 'transparent',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 15 }}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ flexShrink: 0, padding: '14px 16px 0', borderTop: '1px solid var(--border)' }}>
        {plan === 'free' && can(role, 'manageSubscription') && (
          onUpgradeClick ? (
            <button onClick={onUpgradeClick} style={upgradeBtnStyle}>
              Upgrade to Pro
            </button>
          ) : (
            <Link href="/dashboard" style={{ ...upgradeBtnStyle, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Upgrade to Pro
            </Link>
          )
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <ThemeToggle compact />
          {onSignOut && (
            <button
              onClick={onSignOut}
              style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 12.5, cursor: 'pointer', fontWeight: 600 }}
            >
              Sign out
            </button>
          )}
        </div>
        <AppVersion style={{ display: 'block', textAlign: 'center', margin: '10px 0 2px' }} />
      </div>
    </aside>
  );
}

const upgradeBtnStyle = {
  background: 'var(--orange)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '11px 12px',
  fontWeight: 700,
  fontSize: 13.5,
  cursor: 'pointer',
  marginBottom: 12,
};
