# Reseeti — Stage 24: Integrations

Eight integrations, in two very different categories:

- **WhatsApp Business API + three cloud backup providers** — real
  external services, each needing its own API credentials registered
  with that provider before it'll do anything. Genuine setup work, done
  once per deployment.
- **Bluetooth/USB thermal printing + barcode/QR scanning** — entirely
  browser-side, no accounts or credentials needed, but bound by which
  browsers actually implement the underlying Web APIs (Chrome/Edge only,
  notably not Safari/iOS — flagged clearly below and in the code itself).

## 1. WhatsApp Business API

A second reminder channel alongside the existing Twilio SMS one
(`app/api/reminders/send/route.js`) — a business can turn on SMS,
WhatsApp, both, or neither in Business Settings, and the same daily
cron/manual-trigger loop sends through whichever are enabled.

This is genuinely different from the WhatsApp **Share** button already
elsewhere in the app (dashboard "Remind" button, receipt page) — those
use `wa.me` links, which just open WhatsApp with a pre-filled message
for a human to review and tap send. This sends automatically, no tap
required, via Meta's WhatsApp Business Cloud API (`lib/whatsapp.js`).

**The one WhatsApp-specific wrinkle worth understanding**: WhatsApp only
allows freeform text to a customer within 24 hours of that customer
messaging the business first. A reminder is the business initiating
contact, so it falls outside that window and **must** use a
pre-approved message **template**, not plain text. You'll need to:
1. Set up a WhatsApp Business Platform app in
   [developers.facebook.com](https://developers.facebook.com) and get a
   phone number registered.
2. In Meta Business Manager, create and submit a message template named
   to match `WHATSAPP_REMINDER_TEMPLATE_NAME` (default `invoice_reminder`)
   with four `{{1}}`–`{{4}}` variables: customer first name, invoice
   number, amount, payment link. Approval usually takes minutes to a
   couple of days.
3. Add `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` to your env.

Uses one global, platform-level WhatsApp number — same shape as the
existing Twilio/Resend/Paystack integrations (Reseeti's own account
sends on behalf of every business, rather than each business bringing
its own credentials).

## 2–4. Cloud backups (Google Drive, Dropbox, OneDrive)

A new **Backups** page (`/dashboard/backups`, owner-only) where a
business can connect any combination of the three providers. Each
Connect click walks through a real OAuth2 flow — consent screen on the
provider's own site, redirect back, tokens stored encrypted
(`lib/crypto.js`, AES-256-GCM) in a new `cloud_backup_connections` table,
never returned to the browser under any circumstance.

**What gets backed up**: one JSON file per run
(`lib/backupExport.js`) — the business's customers, products, invoices
(with line items), and expenses, named
`Reseeti Backup - {business name} - {date}.json`, uploaded to a
"Reseeti Backups" folder in the connected account (Drive/OneDrive place
it at account root with that name prefix; Dropbox and OneDrive create
the actual folder for you).

**When it runs**: automatically, once daily, for every connected
provider (`vercel.json`'s new cron entry → `app/api/backup/run` GET,
same `CRON_SECRET` protection as the reminders cron). The "Backup now"
button on the Backups page runs the same logic on demand — useful right
before a big change you want a fresh safety copy ahead of.

**Setup** (all three need their own developer console app registered —
there's no way around this, each provider requires it):

| Provider | Where | Redirect URI to register |
|---|---|---|
| Google Drive | console.cloud.google.com → OAuth Client ID (Web application) | `{APP_URL}/api/backup/google/callback` |
| Dropbox | dropbox.com/developers/apps → new app, Scoped access, Full Dropbox, `files.content.write` scope | `{APP_URL}/api/backup/dropbox/callback` |
| OneDrive | portal.azure.com → App registration, "any org + personal Microsoft accounts," `Files.ReadWrite` + `offline_access` | `{APP_URL}/api/backup/onedrive/callback` |

Add each provider's client ID/secret to your env (see
`.env.local.example`), plus a fresh `ENCRYPTION_KEY`
(`openssl rand -hex 32`) for the token encryption. A provider with no
client ID/secret configured shows a clear "not configured yet" message
on Connect rather than a confusing OAuth error — you can turn on just
one or two of the three and leave the rest for later.

Run `supabase/schema_stage24.sql` before any of this works — it adds
the `cloud_backup_connections` table (owner-only RLS) and the
`whatsapp_reminders_enabled` column.

## 5–6. Bluetooth thermal printers & USB receipt printers

A **🖨️ Print receipt** button on the receipt page
(`app/inv/[id]/ReceiptClient.jsx`, via the new
`app/components/PrintReceiptButton.jsx`), offering whichever of the two
transports this browser actually supports:

- **Bluetooth** (`lib/printing/thermalPrint.js`'s `printViaBluetooth`) —
  Web Bluetooth API. Targets the GATT service/characteristic UUID pair
  (`000018f0…` / `00002af1…`) that a large share of generic, no-name
  ESC/POS Bluetooth receipt printers happen to share, from a common
  reference chipset — not a real standard, so it's a "usually works,"
  not a guarantee. A printer that doesn't connect on the first try may
  use different UUIDs; check its spec sheet.
- **USB** (`printViaSerial`) — Web Serial API, for USB thermal printers
  that expose a serial (CDC) interface, which is most cheaper models. A
  printer using a raw USB-printer-class interface instead (no serial
  layer) won't show up here — see "left out" below.

Both build the actual receipt via `lib/printing/escpos.js` — hand-written
ESC/POS command bytes (the near-universal thermal printer command
language), formatted for the common 32-character/58mm paper width, with
NGN spelled out rather than the ₦ symbol since most of these printers'
default code page can't render it reliably.

**Browser support is the real limitation here, not the code**: neither
Web Bluetooth nor Web Serial exists in Safari or Firefox, on any
platform — meaning no iPhone/iPad, ever, can use either path (Apple has
no plans to implement either API). `PrintReceiptButton` simply doesn't
render on browsers that support neither, rather than showing a button
that would only ever throw an error.

## 7–8. Barcode scanners & QR scanners

Two genuinely different scanning paths, covering two different kinds of
hardware:

**Physical scanner input** (`app/components/BarcodeScanInput.jsx`) — the
overwhelming majority of cheap USB/Bluetooth barcode and QR scanners
need **no API integration at all**. They emulate a keyboard: point,
trigger, and the scanner "types" the code followed by Enter into
whatever text field currently has focus. This component is a text input
tuned for exactly that — auto-focused, clears itself after each Enter so
the next scan doesn't need manual clearing first. It's not
scanner-exclusive either; typing a code by hand works identically.

Wired into two places:
- **Invoice creation** (`InvoiceForm.jsx`) — a new "🔢 Scan to add item"
  box above the item rows. Scanning a known product's barcode adds it as
  a line item (or bumps its quantity if already on the invoice);
  scanning an unrecognized code shows an error rather than silently
  adding a mystery item with no real price attached.
- **Inventory** (`ProductForm.jsx`) — the existing barcode field now
  prevents the scanner's trailing Enter from prematurely submitting the
  whole form before price/stock are filled in (a real bug this surfaced:
  every scan into that field before this stage would have tried to save
  the product immediately).

**Camera scanning** (`app/components/CameraBarcodeScanner.jsx`) — for
someone without dedicated scanner hardware, using the device camera via
the browser's native `BarcodeDetector` API. A "📷 Use camera" /
"📷 Scan with camera" option appears next to the scan input in both
places above, **only when the browser actually supports it**. That
support is Chrome/Edge on Android and desktop only — Safari (and by
extension every iOS browser, which all use WebKit) has never implemented
`BarcodeDetector` and there's no announced timeline for it. This is
exactly why the physical-scanner input above is the primary path, not
this one: it works on every device with zero API dependency, while
camera scanning is a bonus for Android/desktop Chrome users specifically.

## Setup

1. Run `supabase/schema_stage24.sql`.
2. Fill in whichever of WhatsApp / Google / Dropbox / OneDrive env vars
   you want live (see `.env.local.example` for exact instructions per
   provider) — each is independently optional; the rest of the app works
   fine with none of them configured, and each surfaces a clear
   "not configured" message rather than a broken button.
3. Printing and scanning need no setup at all — they're live the moment
   this code is deployed, gated only by browser support.

### Test it
1. **WhatsApp**: turn it on in Business Settings, click "Send reminders
   now" on a business with at least one unpaid invoice past the
   days-unpaid threshold. Check for the message on the recipient's
   WhatsApp (needs your template already approved).
2. **Cloud backups**: `/dashboard/backups` → Connect one provider →
   approve on its consent screen → confirm you land back with a
   "connected" notice → click "Backup now" → confirm a
   `Reseeti Backup - ... .json` file appears in that account.
3. **Printing**: on the receipt page, in Chrome/Edge, click
   🖨️ Print receipt → pick Bluetooth or USB → pick your printer from the
   browser's device picker → confirm a receipt actually prints.
4. **Scanning**: on a new invoice, scan (or type) a real product's
   barcode into the "Scan to add item" box → confirm it appears as a
   line item at the correct price. Scan an unknown code → confirm the
   error message, not a bogus item.

## What's deliberately left out of this stage

- **Per-business WhatsApp/cloud credentials** — every business shares
  Reseeti's own WhatsApp number and OAuth apps; a business can't bring
  its own WhatsApp Business number or use a different Google Cloud
  project. Reasonable for now (matches how Twilio/Resend/Paystack already
  work here); a bigger multi-tenant redesign if it's ever needed.
- **CSV/zip backups** — one JSON file per backup, not a zip of CSVs per
  table. No new dependency needed (no zip library in this project) and a
  single JSON is just as restorable; CSV export already exists
  separately via Reports for anyone who specifically wants that format.
- **A restore flow** — backups are write-only from this app's side today;
  restoring a JSON backup back into a business is a manual/support
  operation, not a self-service button. A real "restore" UI is a much
  bigger, riskier feature (conflict handling, partial-restore choices)
  than "make sure a copy exists somewhere safe."
- **WebUSB for printers without a serial interface** — Web Serial covers
  most USB thermal printers, but a printer exposing a raw USB
  printer-class interface with vendor-specific bulk endpoints instead
  would need the lower-level WebUSB API with per-model endpoint
  matching. Not attempted — too printer-model-specific to build
  generically without real hardware to test against.
- **A WASM barcode-scanning fallback for iOS Safari** — camera scanning
  is Chrome/Android-only by relying on the native `BarcodeDetector` API;
  a WebAssembly-based decoder (e.g. ZBar compiled to WASM) could bring
  camera scanning to Safari too, at the cost of a real dependency and
  meaningfully more code. Physical scanner input already covers iOS
  users completely (it's just keyboard input), so this was judged lower
  priority than the rest of this stage.
- **Bluetooth/Serial device "remembering"** — every print currently opens
  the browser's device picker fresh; neither `getDevices()` (Bluetooth)
  nor `getPorts()` (Serial) reconnect-without-prompting is wired up yet,
  so it's one extra tap each time versus feeling instant.
