# Reseeti — Stage 16: Loyalty Discounts & SMS Reminders

Two features, both configured from Business Settings, bundled together
because they touch the same area of the app (invoice creation and unpaid
invoices) and share nothing that made sense to build separately.

## Loyalty discounts

**How it works:** enable it in Settings, set a purchase threshold
(default 10) and a discount percentage (default 5%). Once a customer
*profile* has reached that many **paid** invoices, the next time they're
picked from the customer dropdown while creating a new invoice, a green
banner appears: *"🎉 [Name] has made 10 paid purchases — eligible for a
5% loyalty discount."* The discount is applied automatically, with a
checkbox to switch it off for that one sale if needed.

**Why paid invoices, not just any invoice:** an unpaid invoice isn't a
completed purchase yet — counting it would let someone qualify for a
loyalty discount before they'd actually bought anything.

**Why walk-in customers can never qualify:** loyalty tracks a customer
*profile's* history. A walk-in sale (no profile attached) has no history
to check — this is a natural, not an arbitrary, limitation.

**Where the discount applies in the math:** alongside the existing manual
discount field, both subtracted from the subtotal before service
charge/VAT/shipping/withholding tax are calculated — so a loyalty
discount correctly reduces the VAT base too, not just the final total.

**Frozen onto the invoice, not recalculated later:** like VAT and service
charge (Stage 15), the actual loyalty discount amount is stored on the
invoice itself (`loyalty_discount_amount`) at the moment it's created. If
you change the loyalty percentage next month, old invoices keep showing
what was true when they were issued.

## SMS reminders for unpaid invoices

**What it sends**, to the customer's phone, once an invoice has been
unpaid for your configured number of days (default 3):

> Dear John, Invoice INV-203 remains unpaid. Amount: NGN 15,000. View & pay: [link]

**This is a different Twilio integration than phone login.** Your
existing OTP login already uses Twilio, but that's configured entirely
inside Supabase's dashboard — Supabase never hands those credentials back
to this app's code. Sending an arbitrary SMS (not a login code) needs
this app to hold its *own* Twilio credentials as environment variables:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1xxxxxxxxxx
```

You can reuse the same Twilio account you already set up for OTP login —
just copy the same Account SID/Auth Token into these new variable names,
and use the same From number if you like (or a different one).

**This costs real money per message.** Twilio charges per SMS sent, so
this is off by default. Turn it on deliberately in Settings once you're
ready.

### "Automatically send" — what this actually means, and its one real limitation

**The honest limitation, stated plainly:** true automatic, scheduled
sending only works once this app is **deployed to Vercel** (or another
platform with an equivalent scheduler). Running `npm run dev` locally,
nothing will trigger reminders on its own — there's no persistent process
sitting around checking the clock. This is inherent to how serverless
Next.js apps work, not a shortcut taken here.

**Two ways reminders actually get sent:**

1. **Automatic (production only)** — `vercel.json` configures a daily
   Vercel Cron job that hits `/api/reminders/send` at 8:00 UTC (9am WAT).
   It checks every business with SMS reminders enabled and sends what's
   due. Protected by a `CRON_SECRET` environment variable — Vercel
   automatically sends this as a Bearer token when it invokes the cron
   job, and the route rejects anything that doesn't match, so the
   endpoint isn't triggerable by just finding the URL.

2. **Manual, works anywhere, any time** — a **"Send reminders now"**
   button right in Business Settings. This calls the same endpoint but
   scoped to only your own business, using your normal login session
   instead of the cron secret. Useful for testing locally, or if you'd
   rather trigger reminders yourself than rely on the schedule.

### Setup

**1. Get Twilio SMS credentials** (see above) and add them to
`.env.local` for local testing, and to your Vercel project's environment
variables for production.

**2. Generate a CRON_SECRET** (only needed for the automatic path):
```
# any random 16+ character string, e.g.:
openssl rand -hex 16
```
Add it as `CRON_SECRET` in Vercel's project environment variables.
**Do not** put a real one in `.env.local` if that file might ever be
committed — generate it fresh in Vercel's dashboard instead.

**3. Run the migration** — Supabase SQL editor → `schema_stage16.sql`.

**4. Deploy to Vercel** (or your platform of choice) for the automatic
daily path to start working. `vercel.json` is already in the project
root and takes effect on the next deploy — no dashboard configuration
needed beyond setting the env vars above.

**5. Test locally without deploying:** run the app locally, turn on SMS
reminders in Settings for a test business with a genuinely overdue unpaid
invoice, and click **Send reminders now**. This works identically whether
local or deployed, since it doesn't depend on Vercel Cron at all.

## What's deliberately left out of this stage

- **No loyalty tiers** (e.g. bronze/silver/gold with different
  discounts) — one flat threshold and one flat percentage. Worth
  revisiting once there's a sense of whether businesses actually want
  multiple tiers.
- **No SMS delivery status tracking beyond sent/failed** — Twilio does
  offer delivery receipts (did the SMS actually reach the phone, not just
  "did Twilio accept it"), but wiring that up needs a separate webhook and
  wasn't in scope here. Right now, "sent" means Twilio's API accepted the
  request, not confirmed delivery.
- **No reminder for invoices without a phone number on file** — silently
  skipped, since there's nowhere to send it. Worth a small "N invoices
  couldn't be reminded — no phone on file" note somewhere if this turns
  out to happen often.
- **Cron cadence is fixed at once daily** — Vercel's Hobby plan only
  supports daily cron cadence anyway; Pro plans allow more frequent
  schedules if a business wants faster reminder turnaround later.
