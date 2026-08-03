'use client';

import { useEffect, useState } from 'react';

// A small always-visible pill in the header, distinct from the detailed
// offline/syncing banner on the dashboard home page (which also shows
// queued-draft counts and a "Sync now" button). That banner only exists
// on dashboard/page.js; this badge is in DashboardShell so it's visible
// on every page under /dashboard — Customers, Inventory, Reports, etc. —
// where someone could otherwise have no idea they've lost connection
// until an action fails.
export default function OfflineBadge() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Nothing to say while online — showing "Online" everywhere all the
  // time would just be noise; the badge only earns its place on screen
  // when it's telling you something you'd otherwise miss.
  if (isOnline) return null;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11.5,
        fontWeight: 700,
        color: 'var(--orange-dark)',
        background: 'var(--orange-bg)',
        border: '1px solid var(--orange)',
        borderRadius: 12,
        padding: '4px 10px',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--orange-dark)',
          flexShrink: 0,
        }}
      />
      Offline
    </span>
  );
}
