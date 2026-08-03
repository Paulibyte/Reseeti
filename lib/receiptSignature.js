import crypto from 'crypto';

// A lightweight tamper-evidence check — NOT a legally-binding digital
// signature or a PKI/e-signature scheme. It's an HMAC-SHA256 over a few
// stable invoice fields, keyed with a server-only secret, truncated to a
// short code that fits neatly on a receipt.
//
// The point isn't cryptographic non-repudiation — it's that a business
// owner or customer can hold up a printed/screenshotted receipt next to
// what /verify/{code} shows (freshly re-fetched from the database, with
// this same hash recomputed from the real stored values) and see at a
// glance whether the numbers on the paper match the numbers on record.
// If someone edited a screenshot to change the total, the hash on their
// copy won't match what /verify recomputes for that invoice.
//
// Server-only: never import this from a 'use client' component, since
// RECEIPT_SIGNING_SECRET must never reach the browser bundle.
export function computeReceiptSignature({ invoiceId, invoiceNumber, businessId, total, createdAt }) {
  const secret = process.env.RECEIPT_SIGNING_SECRET || 'reseeti-dev-only-insecure-secret';
  const payload = `${invoiceId}|${invoiceNumber}|${businessId}|${total}|${createdAt}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 12).toUpperCase();
}
