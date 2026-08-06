'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import AppVersion from './AppVersion';
import { can } from '../../lib/permissions';
import { NAV_ITEMS } from './navItems';

// Mobile counterpart to Sidebar.jsx. The desktop sidebar is `display: none`
// below 880px (see globals.css), so phones — which is most Reseeti users —
// had no way to reach anything past Dashboard/Invoices other than the
// "Create Invoice" FAB. This renders the same nav list (same permission
// filtering) as a full-screen slide-in drawer, opened from a hamburger
// button in the header and closed by the backdrop, the X, or picking a link.
export default function MobileNavDrawer({ open, onClose, plan = 'free', role, onUpgradeClick, onSignOut }) {
  const pathname = usePathname();
  const navItems = NAV_ITEMS.filter((item) => !item.permission || can(role, item.permission));

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--overlay)',
          zIndex: 90,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
        }}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 'min(84vw, 300px)',
          background: 'var(--surface)',
          zIndex: 91,
          display: 'flex',
          flexDirection: 'column',
          padding: '18px 0',
          boxShadow: '2px 0 20px rgba(0,0,0,0.2)',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.2s ease',
        }}
      >
        <div style={{ flexShrink: 0, padding: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Logo size={28} showWordmark />
            <button
              onClick={onClose}
              aria-label="Close menu"
              style={{
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                width: 34,
                height: 34,
                fontSize: 15,
                cursor: 'pointer',
                color: 'var(--text-muted)',
              }}
            >
              ✕
            </button>
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

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px' }}>
          {navItems.map((item) => {
            const active = item.href === '/dashboard' ? pathname === '/dashboard' : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={onClose}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '12px 12px',
                  borderRadius: 8,
                  fontSize: 15,
                  fontWeight: 600,
                  textDecoration: 'none',
                  color: active ? 'var(--orange-dark)' : 'var(--text-muted)',
                  background: active ? 'var(--orange-bg)' : 'transparent',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 16 }}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ flexShrink: 0, padding: '14px 16px 0', borderTop: '1px solid var(--border)' }}>
          {plan === 'free' && can(role, 'manageSubscription') && (
            onUpgradeClick ? (
              <button
                onClick={() => {
                  onClose?.();
                  onUpgradeClick();
                }}
                style={upgradeBtnStyle}
              >
                Upgrade to Pro
              </button>
            ) : (
              <Link
                href="/dashboard"
                onClick={onClose}
                style={{ ...upgradeBtnStyle, display: 'block', textAlign: 'center', textDecoration: 'none' }}
              >
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
    </>
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
