'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Next.js's own file-system convention for a root-level error boundary
// — catches anything that escapes every other error handling in the
// app (a crash in the root layout itself, for instance, which no
// regular error.jsx nested under it could ever catch). Rare in
// practice, but when it happens the person sees a blank white screen
// with no explanation unless this file exists.
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#F7F3EA', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 style={{ color: '#0E1A2B', fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ color: '#5A5044', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              Reseeti hit an unexpected error. It's been reported automatically — try again, or reload the page if
              that doesn't help.
            </p>
            <button
              onClick={reset}
              style={{
                background: '#E67E22', color: '#fff', border: 'none', borderRadius: 8,
                padding: '11px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
