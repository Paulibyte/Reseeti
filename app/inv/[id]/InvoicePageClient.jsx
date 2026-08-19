'use client';

import { useEffect, useState } from 'react';
import ReceiptClient from './ReceiptClient';
import { cacheReceipt, getCachedReceipt } from '../../../lib/receiptCache';

// Replaces what used to be server-rendered in page.js. The reason this
// moved to the client: a server-rendered page fundamentally cannot work
// offline — every visit required a live round trip to Reseeti's own
// server, no matter how anything else was cached. This resolves data the
// same way every other page in the app already does (try a live fetch,
// fall back to a local cache), which is what actually makes offline
// access to a previously-viewed receipt possible at all.
export default function InvoicePageClient({ invoiceId }) {
  const [state, setState] = useState({ status: 'loading', data: null, fromCache: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/receipt-data`);
        if (!res.ok) throw new Error(res.status === 404 ? 'not_found' : 'fetch_failed');
        const data = await res.json();
        if (cancelled) return;
        setState({ status: 'ready', data, fromCache: false });
        // Best-effort — see lib/receiptCache.js. Doesn't block rendering
        // on this succeeding.
        cacheReceipt(invoiceId, data);
      } catch (err) {
        if (cancelled) return;
        if (err.message === 'not_found') {
          setState({ status: 'not_found', data: null, fromCache: false });
          return;
        }
        // Live fetch failed (most likely: genuinely offline) — fall back
        // to whatever was cached the last time this exact receipt was
        // successfully viewed. If it was never viewed before on this
        // device, there's nothing to fall back to.
        const cached = await getCachedReceipt(invoiceId);
        if (cancelled) return;
        if (cached) {
          setState({ status: 'ready', data: cached, fromCache: true });
        } else {
          setState({ status: 'offline_no_cache', data: null, fromCache: false });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [invoiceId]);

  if (state.status === 'loading') {
    return (
      <main style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center', padding: '0 20px', fontFamily: 'sans-serif' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading receipt…</p>
      </main>
    );
  }

  if (state.status === 'not_found') {
    return (
      <main style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center', padding: '0 20px', fontFamily: 'sans-serif' }}>
        <p style={{ color: 'var(--text-muted)' }}>This invoice link doesn&apos;t exist or may have been removed.</p>
      </main>
    );
  }

  if (state.status === 'offline_no_cache') {
    return (
      <main style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center', padding: '0 20px', fontFamily: 'sans-serif' }}>
        <p style={{ color: 'var(--text-muted)' }}>
          You&apos;re offline, and this receipt hasn&apos;t been opened on this device before, so there&apos;s no local copy
          to show. Reconnect and open it once to make it available offline going forward.
        </p>
      </main>
    );
  }

  return (
    <>
      {state.fromCache && (
        <div style={{ background: 'var(--orange-bg)', color: 'var(--orange-dark)', textAlign: 'center', padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>
          You&apos;re offline — showing the last copy of this receipt saved on this device.
        </div>
      )}
      <ReceiptClient
        invoice={state.data.invoice}
        business={state.data.business}
        signature={state.data.signature}
        offlineMode={state.fromCache}
      />
    </>
  );
}
