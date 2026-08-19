import InvoicePageClient from './InvoicePageClient';

// Deliberately minimal now — the actual data fetch and signature
// computation moved to app/api/invoices/[id]/receipt-data/route.js, and
// resolving that data (live fetch, falling back to a local cache when
// offline) moved to InvoicePageClient.jsx. This page used to do all of
// that itself during server rendering, which meant every single visit —
// online or not — required a live round trip to Reseeti's own server;
// no caching strategy could work around that. See InvoicePageClient.jsx
// for the fix.
export default function PublicInvoicePage({ params }) {
  return <InvoicePageClient invoiceId={params.id} />;
}
