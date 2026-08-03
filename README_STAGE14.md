# Reseeti — Stage 14: Receipt improvements + Nigerian bank transfer feature

## What's new on the receipt (`app/inv/[id]/ReceiptClient.jsx`)

- **QR code** — scans straight back to this digital receipt (`/inv/{id}`).
- **Barcode** — Code128, encoding the invoice number. This is a familiar
  "looks like a real receipt" convention (like a POS till slip) — nothing
  in the app actually scans it.
- **Watermark** — the business name, faint and diagonal, behind the whole
  receipt.
- **Receipt verification code** — a short code, auto-generated per invoice
  (see the migration below), linking to a new public page:
  **`/verify/{code}`**, which re-fetches the real invoice from the
  database and shows its actual amount/status — so a tampered screenshot
  or printout won't match what that page shows.
- **"Digital signature"** — a 12-character HMAC-SHA256 hash computed from
  the invoice's core fields with a server-only secret
  (`lib/receiptSignature.js`). **Worth being clear about what this is and
  isn't**: it's a tamper-evidence check, not a legally-binding e-signature
  or a PKI scheme. It's there so the hash printed on a receipt can be
  compared against the one `/verify/{code}` recomputes live.
- **Payment method** — shown under the total when an invoice is paid (see
  the "Mark paid" flow below).
- **Bank details / "Pay via bank transfer" panel** — shown on unpaid
  invoices once a business has entered bank details in Settings, with a QR
  encoding the transfer details as text. **Not a Nigerian interbank
  scan-to-pay standard** (no such universal standard is integrated here) —
  it's a convenience for the customer to read/copy the details, not an
  initiate-payment QR.
- **Terms & conditions** — shown at the bottom if the business has set any.
- **Seller / customer signatures** — the seller's uploaded signature image,
  and a small drawable pad the customer can sign directly on the receipt
  page. Also not a legally-binding e-signature — a quick acknowledgement
  gesture, write-once (see the API route below).
- **Estimated delivery date** — optional, set when creating an invoice,
  shown near the invoice date if present.
- Company logo was already there from an earlier stage.

## The Nigerian "Bank Transfer Confirmation" feature

This is deliberately **not** an automatic bank-verification integration —
Reseeti has no NIBSS/Mono/bank-API connection, and claiming one would be
misleading. What's actually built:

1. A business enters their bank name/account name/account number once, in
   **Settings**.
2. Unpaid invoice receipts show those details + a QR to a customer, plus
   an "I've sent this" button that opens WhatsApp to the seller with a
   pre-filled message (no database write — purely a convenience nudge).
3. **The business marks the invoice paid themselves**, from the
   **Dashboard** invoice list, after checking their own bank app/alert.
   This now opens a small modal asking *how* it was paid (cash / bank
   transfer / card / other) — that's what feeds the new "Paid via ___"
   line on the receipt.

**Why "Mark Paid" isn't a button on the public receipt page**: that page
has no login — it's a link anyone can open. A "Mark Paid" button there
would let *anyone* with the link mark their own invoice paid without
actually transferring anything. Keeping that action on the authenticated
dashboard side is a deliberate security boundary, not an oversight.

## Schema changes — run `supabase/schema_stage14.sql`

Adds, on `businesses`: `bank_name`, `bank_account_name`,
`bank_account_number`, `terms_and_conditions`, `signature_url` (reuses the
existing `logos` storage bucket/policies — no new bucket needed).

Adds, on `invoices`: `payment_method`, `estimated_delivery_date`,
`customer_signature_data`, `verification_code` (auto-generated for every
existing and future row, with a uniqueness constraint).

## New env var

`RECEIPT_SIGNING_SECRET` — any random string (`openssl rand -hex 32`
works). See `.env.local.example`.

## New dependencies

`qrcode` and `jsbarcode` — both generate their output entirely client-side
(no network calls), which matters for an app that's otherwise built to
work offline.

## Known limitations worth knowing about

- The customer signature pad writes are public and write-once (can't be
  overwritten once set) — appropriate given a drawn signature on an
  unauthenticated page was never going to carry a strong identity
  guarantee, but worth knowing rather than assuming it's equivalent to a
  verified in-person signature.
- If a receipt is downloaded as PDF *before* the customer has signed, the
  signature pad's blank canvas + buttons are excluded from the PDF (via
  `data-html2canvas-ignore`), but the panel will still show an empty
  signature line rather than nothing.
- The bank-transfer QR content (plain text) hasn't been tested against a
  Nigerian banking app's QR scanner expecting a specific payload format,
  since no such standard is targeted — treat it as a fallback for a
  QR-reading app, not a bank app's "scan to pay" flow.
