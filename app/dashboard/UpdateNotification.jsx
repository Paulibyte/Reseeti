'use client';

import { useEffect, useState } from 'react';
import { onUpdateAvailable, applyUpdate } from '../../lib/pwa';

// A new version sitting in the service worker's "waiting" state (see
// lib/pwa.js + public/sw.js) doesn't take over on its own anymore — this
// is the UI half of that decision. Refreshing on click hands control to
// the new worker and reloads; ignoring this banner is completely safe,
// since the app keeps working fine on the old version until the person
// is ready (or just closes and reopens the tab, which also picks up the
// update naturally).
export default function UpdateNotification() {
  const [available, setAvailable] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => onUpdateAvailable(setAvailable), []);

  if (!available) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: 20,
        right: 20,
        bottom: 90,
        maxWidth: 420,
        margin: '0 auto',
        background: 'var(--heading)',
        color: '#fff',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        boxShadow: 'var(--shadow)',
        zIndex: 60,
      }}
    >
      <span style={{ fontSize: 13.5, fontWeight: 600 }}>
        A new version of Reseeti is available.
      </span>
      <button
        onClick={() => { setApplying(true); applyUpdate(); }}
        disabled={applying}
        style={{
          background: 'var(--orange)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '7px 14px',
          fontSize: 12.5,
          fontWeight: 700,
          cursor: applying ? 'default' : 'pointer',
          flexShrink: 0,
        }}
      >
        {applying ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
