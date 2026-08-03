'use client';

import { useEffect, useRef, useState } from 'react';

const DEFAULT_ITEMS = [
  { icon: '✅', text: 'Invoice paid' },
  { icon: '🔄', text: 'Subscription renewed' },
  { icon: '👀', text: 'Customer viewed invoice' },
];

export default function NotificationsBell({ items }) {
  const list = items && items.length ? items : DEFAULT_ITEMS;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        style={{
          position: 'relative',
          background: 'var(--surface-alt)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          cursor: 'pointer',
        }}
      >
        🔔
        {list.length > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'var(--orange)',
              border: '1.5px solid var(--surface)',
            }}
          />
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 44,
            width: 240,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            padding: 8,
            zIndex: 30,
          }}
        >
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-faint)', margin: '4px 8px 8px' }}>
            Notifications
          </p>
          {list.map((n, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 8px',
                borderRadius: 6,
                fontSize: 13.5,
                color: 'var(--text)',
              }}
            >
              <span>{n.icon}</span>
              <span>{n.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
