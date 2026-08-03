# Reseeti — Stage 3: PDF export, WhatsApp share, public invoice links

This ports over the prototype's PDF and WhatsApp features, but improves on
the original design: instead of only downloading a PDF locally and manually
attaching it to a WhatsApp chat, every saved invoice now gets a **public,
shareable link**.

## What changed

- **`/inv/[id]`** — a new public page, no login required. Anyone with the
  link can view the invoice, download it as a PDF, or share it further.
- The **Share** link on each dashboard invoice row opens this page in a
  new tab.
- On the public page, **Share on WhatsApp** now sends the customer a link
  to view/download the invoice themselves, rather than a text-only summary
  with the PDF attached manually — closer to how invoicing tools like this
  actually get used day to day.
- Both PDF export (`html2canvas` + `jsPDF`) and the WhatsApp link now run
  as real npm dependencies instead of CDN `<script>` tags, so they bundle
  properly with the rest of the app.

## Why a public page instead of just a downloadable PDF

- A link works instantly on any device, with zero data cost to open (versus
  downloading a PDF file over a possibly-slow connection).
- The business doesn't need to remember to attach the PDF after generating
  it — one WhatsApp message, one tap, done.
- It sets up naturally for a future "Pay now" button directly on this page
  (a Paystack payment link scoped to the invoice) — worth keeping in mind
  as a near-term addition once Stage 2's billing is stable.

## Security note — worth understanding, not just copying

The public page uses `lib/supabaseAdmin.js` (the service-role key) to fetch
the invoice, deliberately bypassing row-level security, because a visitor
here has no Supabase session at all — there's no `auth.uid()` for a policy
to check against.

This is safe **only because**:
1. The invoice `id` is a UUID — not sequentially guessable.
2. The query explicitly selects a narrow set of columns (`name`, `phone`,
   `address` from `businesses`) and never touches `email`,
   `paystack_customer_code`, or other sensitive fields.

If you extend this page later, keep being deliberate about exactly which
columns get selected here — it's easy to accidentally leak a field by
changing a `select('*')` without thinking about who's allowed to see it.

## Setup
No new environment variables or database changes are needed for this
stage. Just:
```
npm install
npm run dev
```
`html2canvas` and `jspdf` were added to `package.json`, so `npm install`
will pull them in.

## Next: Stage 4
Retention features — payment reminder nudges for unpaid invoices (the
highest-value Pro feature for traders who sell on credit), a simple
dashboard summary (money owed this month, top customers), and logo upload
for branding.
