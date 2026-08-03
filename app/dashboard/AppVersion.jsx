'use client';

import { APP_VERSION } from '../../lib/version';

export default function AppVersion({ style }) {
  return (
    <span style={{ fontSize: 10.5, color: 'var(--text-faint)', ...style }}>
      Reseeti v{APP_VERSION}
    </span>
  );
}
