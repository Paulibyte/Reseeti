# Reseeti — Stage 1: Accounts & sync

This turns the single-device prototype into a real app: phone-number login,
and invoices stored in Postgres so they sync across every device a business
owner logs in from.

## What's included
- `supabase/schema.sql` — tables (businesses, invoices, invoice_items) with
  row-level security, so a business can only ever read/write its own data.
- `app/login` — phone number + OTP login (no passwords — matches how most
  people already use their phone here).
- `app/dashboard` — invoice list, creation form, paid/unpaid toggle, the
  same 5-invoices-per-month free tier logic as the prototype.

## Setup

### 1. Create a Supabase project
Go to supabase.com, create a free project, and note your **Project URL**
and **anon public key** from Project Settings > API.

### 2. Enable phone auth
In the Supabase dashboard: Authentication > Providers > Phone.
You'll need to connect an SMS provider (Twilio, MessageBird, or Vonage) —
Supabase walks you through this. Twilio is the most commonly used; expect
to pay per SMS sent (a few naira-cents equivalent per OTP).

### 3. Run the schema
Open the SQL Editor in Supabase, paste in `supabase/schema.sql`, and run it.
This creates the tables, security policies, and a trigger that auto-creates
a business profile the moment someone signs up.

### 4. Configure environment variables
```
cp .env.local.example .env.local
```
Fill in your Supabase URL and anon key.

### 5. Install and run
```
npm install
npm run dev
```
Visit `http://localhost:3000`.

## What's deliberately NOT in this stage
- Payments / Paystack subscription (that's Stage 2)
- PDF export and WhatsApp share (port these over from the prototype once
  the data layer is stable — they don't depend on the backend)
- Logo upload, business address editing UI (small additions, same pattern
  as the invoice form)

## Next: Stage 2
Wire up Paystack for the ₦1,500/month Pro subscription, with a webhook
that flips `businesses.plan` to `'pro'` on successful payment.
