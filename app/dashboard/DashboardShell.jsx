'use client';

import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import MobileNavDrawer from './MobileNavDrawer';
import NotificationsBell from './NotificationsBell';
import MobileFAB from './MobileFAB';
import OfflineBadge from './OfflineBadge';
import InstallPrompt from './InstallPrompt';
import UpdateNotification from './UpdateNotification';
import FeedbackButton from './FeedbackButton';
import PendingInvitesBanner from './PendingInvitesBanner';
import BusinessSwitcher from './BusinessSwitcher';
import Logo from '../components/Logo';
import { createClient } from '../../lib/supabaseClient';
import { getMyBusiness } from '../../lib/getMyBusiness';

export default function DashboardShell({
  plan = 'free',
  role,
  overrides,
  onUpgradeClick,
  onSettingsClick,
  onCreateInvoice,
  onSignOut,
  notifications,
  children,
}) {
  const [navOpen, setNavOpen] = useState(false);
  // Fetched independently here rather than threaded down as a prop from
  // every one of the 30+ pages that render DashboardShell — this is the
  // one place a switcher needs to exist, so it's simpler for it to load
  // its own small slice of data than to change every page's signature.
  const [businesses, setBusinesses] = useState([]);
  const [currentBusinessId, setCurrentBusinessId] = useState(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { business, businesses: list } = await getMyBusiness(supabase);
      setBusinesses(list || []);
      setCurrentBusinessId(business?.id || null);
    })();
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar plan={plan} role={role} overrides={overrides} onUpgradeClick={onUpgradeClick} onSignOut={onSignOut} />
      <MobileNavDrawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        plan={plan}
        role={role}
        overrides={overrides}
        onUpgradeClick={onUpgradeClick}
        onSignOut={onSignOut}
      />

      <div className="reseeti-content">
        <PendingInvitesBanner />
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              className="reseeti-mobile-only"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                width: 36,
                height: 36,
                fontSize: 16,
                cursor: 'pointer',
                color: 'var(--text)',
              }}
            >
              ☰
            </button>
            <div className="reseeti-mobile-logo" style={{ display: 'flex' }}>
              <Logo size={26} showWordmark />
            </div>
            <BusinessSwitcher businesses={businesses} currentId={currentBusinessId} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
            <OfflineBadge />
            <NotificationsBell items={notifications} />
            {onSignOut && (
              <button
                onClick={onSignOut}
                className="reseeti-mobile-only"
                style={{
                  background: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                Sign out
              </button>
            )}
            {onSettingsClick && (
              <button
                onClick={onSettingsClick}
                aria-label="Settings"
                style={{
                  background: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  width: 36,
                  height: 36,
                  fontSize: 15,
                  cursor: 'pointer',
                }}
              >
                ⚙️
              </button>
            )}
          </div>
        </header>

        <main style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px 100px' }}>
          {children}
        </main>
      </div>

      {onCreateInvoice && <MobileFAB onClick={onCreateInvoice} />}
      {/*
        Update takes priority over install (see InstallPrompt.jsx, which
        hides itself while an update is pending) — only one of these two
        ever shows at once, both rendered here so they cover every
        /dashboard/* page rather than just the home page.
      */}
      <UpdateNotification />
      <InstallPrompt />
      <FeedbackButton />
    </div>
  );
}
