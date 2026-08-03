'use client';

import { useEffect } from 'react';
import { registerServiceWorker, initInstallPrompt } from '../lib/pwa';

// Registered once, globally (this sits in the root layout so it covers
// every route — including the public /inv/[id] receipt page, which also
// benefits from offline caching even though it has no PWA install UI of
// its own). The actual install-prompt banner and update-available toast
// are separate components (InstallPrompt.jsx, UpdateNotification.jsx)
// rendered inside DashboardShell — this component only wires up the
// underlying browser APIs so those UI pieces have something to
// subscribe to.
export default function RegisterSW() {
  useEffect(() => {
    initInstallPrompt();
    registerServiceWorker();
    // Fire-and-forget — just makes sure the CSRF cookie (lib/csrf.js)
    // exists before the person does anything that needs it. No session
    // required for this call itself.
    fetch('/api/csrf').catch(() => {});
  }, []);

  return null;
}
