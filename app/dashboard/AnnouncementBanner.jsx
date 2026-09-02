'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'reseeti_dismissed_announcement';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Dismissal is deliberately just localStorage, keyed to today's date —
// not a database table. Reappearing the next day is the actual
// requirement, which a plain date comparison handles with no server
// round trip and nothing to sync across devices; a promo banner doesn't
// need the durability a real business record would.
function wasDismissedToday(id) {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const { id: dismissedId, date } = JSON.parse(raw);
    return dismissedId === id && date === todayStr();
  } catch {
    return false;
  }
}

function markDismissed(id) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ id, date: todayStr() }));
  } catch {
    // Best-effort — private browsing or a full storage quota just means
    // it may show again sooner than usual, not a functional break.
  }
}

export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    fetch('/api/announcements/active')
      .then((res) => res.json())
      .then((data) => {
        const a = data?.announcement;
        if (a && !wasDismissedToday(a.id)) {
          setAnnouncement(a);
          setVisible(true);
        }
      })
      .catch(() => {});
  }, []);

  if (!visible || !announcement) return null;

  function dismiss() {
    markDismissed(announcement.id);
    setVisible(false);
  }

  return (
    <div
      style={{
        position: 'fixed', bottom: 20, right: 20, left: 20, maxWidth: 380, marginLeft: 'auto',
        background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '4px solid var(--orange)',
        borderRadius: 10, padding: '16px 18px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 60,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14.5, color: 'var(--heading)', fontFamily: 'var(--font-heading)' }}>
          {announcement.title}
        </p>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}
        >
          ×
        </button>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>{announcement.message}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        {announcement.cta_label && announcement.cta_url && (
          <a
            href={announcement.cta_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={dismiss}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, fontWeight: 700, fontSize: 12.5, textDecoration: 'none', cursor: 'pointer' }}
          >
            {announcement.cta_label}
          </a>
        )}
        <button
          onClick={dismiss}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: 6, fontSize: 12.5, cursor: 'pointer' }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
