# Deploying Reseeti

A full runbook for taking Reseeti from a local checkout to a live,
production deployment. This assumes every migration through
`schema_stage27.sql` has been applied, in order — see
`supabase/MIGRATIONS.md` if you're starting from an earlier stage.

Work through this section by section; several steps depend on ones
before them (your real domain has to be decided before OAuth redirect
URIs can be registered, for instance).

---

## 1. Accounts to create first

| Service | Used for | Required? |
|---|---|---|
| [Supabase](https://supabase.com) | Database, auth, storage, realtime | **Required** |
| [Vercel](https://vercel.com) (or any Next.js host) | Hosting, cron jobs | **Required** |
| [Twilio](https://twilio.com) | SMS reminders, login alerts | **Required** for those features |
| [Resend](https://resend.com) | Transactional emails | **Required** for email features |
| [Paystack](https://paystack.com) | Recurring Pro subscriptions | Recommended — the only gateway with true auto-renewal |
| OPay / Monnify | Alternative payment gateways | Optional |
| [Meta for Developers](https://developers.facebook.com) | WhatsApp reminders | Optional |
| [Google AI Studio](https://aistudio.google.com) | AI features | Optional |
| Google Cloud / Dropbox / Azure | Cloud backup OAuth apps | Optional |
| [Sentry](https://sentry.io) | Error monitoring | Recommended |
| A domain | Your production URL | Recommended |

---

## 2. Set up Supabase

1. Create a new project. Note the **Project URL**, **anon key**, and
   **service_role key** from Settings → API.
2. **Run every migration in order** in the SQL editor — `schema.sql`,
   `schema_stage2.sql`, `schema_stage3.sql`, … through
   `schema_stage27.sql`. Don't skip ahead; later stages `alter table`
   things earlier stages created. (If you have an old copy of
   `schema_stage26.sql` lying around, make sure it's the corrected
   version — the original had a bug colliding with `platform_settings`,
   which Stage 15 already creates.)
3. **Create three Storage buckets**, all **private**:
   - `logos`
   - `platform-backups`
   - `feedback-screenshots`
4. **Turn on Phone Auth**: Authentication → Providers → Phone, with an
   SMS provider connected (Twilio, same account you'll use for the SMS
   reminder integration works fine).
5. **Confirm Realtime is on** for `invoices`, `products`, and
   `customers` — Database → Replication. Stage 26's migration adds them
   automatically; this is just a sanity check.
6. **Bootstrap your first platform admin** (only if using `/admin`):
   sign in through the real app once, find your User UID under
   Authentication → Users, then in the SQL editor:
   ```sql
   insert into platform_admins (user_id, label) values ('<your-user-uid>', 'Founder');
   ```

---

## 3. Environment variables

Use **`.env.production.example`** in this repo — it's every variable
across all 27 stages, organized by service with clear required/optional
markers, rather than scattered across per-stage `.env.local.example`
additions. Copy it, fill it in, and note two things:

- `NEXT_PUBLIC_APP_URL` has to be your **final** domain before you
  register any OAuth redirect URI or payment webhook — several of those
  have to match it exactly, character for character.
- Every optional integration is designed to fail gracefully (a clear
  "not configured" message) when its variables are left unset — you can
  ship with just the Core + SMS + Email sections filled in and add the
  rest later without anything breaking.

---

## 4. Deploy to Vercel

1. Push the code to a GitHub/GitLab repo if it isn't already.
2. Vercel → New Project → import the repo.
3. Project Settings → Environment Variables — paste in everything from
   Step 3, for Production (and Preview/Development if you use those).
4. Deploy. `npm install` and `next build` run automatically, pulling in
   `@sentry/nextjs` and `@playwright/test`.
5. **Cron jobs** (`vercel.json`: reminders, backups, subscription-expiry
   checks) activate automatically on deploy — but check your current
   Vercel plan's cron limits, since these have changed over time and a
   free tier may cap how many/how often. If crons don't fire on your
   plan, trigger those routes externally instead (e.g. a scheduled
   GitHub Action hitting the URL with `Authorization: Bearer
   $CRON_SECRET`).
6. Add your **custom domain** in Vercel's domain settings, then go back
   and set `NEXT_PUBLIC_APP_URL` to match exactly, and redeploy.

---

## 5. Post-deploy configuration

These need your live URL to exist first:

1. **Payment webhooks** — in each gateway's dashboard, register:
   - Paystack: `https://yourdomain.com/api/paystack/webhook`
   - OPay: `https://yourdomain.com/api/opay/webhook`
   - Monnify: `https://yourdomain.com/api/monnify/webhook`
2. **OAuth redirect URIs** (Google Cloud Console, Dropbox App Console,
   Azure AD app registration) — each needs
   `https://yourdomain.com/api/backup/{provider}/callback` added
   exactly.
3. **WhatsApp** — register your webhook if using inbound messaging, and
   get your reminder template approved in Meta Business Manager before
   `whatsapp_reminders_enabled` will actually deliver anything.
4. **Sentry source maps** — upload automatically on the next build once
   `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` are set.

---

## 6. Verification checklist

Walk through this on the real deployed URL before calling it live:

- [ ] Sign up / log in with a real phone number, receive a real SMS OTP
- [ ] Create a business, create an invoice, confirm the shareable
      `/inv/[id]` link works
- [ ] Trigger each cron manually and confirm 200, not 401:
      `curl -H "Authorization: Bearer $CRON_SECRET" https://yourdomain.com/api/reminders/send`
      (repeat for `/api/backup/run` and `/api/subscription/check-expiry`)
- [ ] Make a small real test payment through each gateway you enabled,
      confirm the webhook upgrades the plan
- [ ] Throw a test error and confirm it lands in Sentry
- [ ] `/dashboard/diagnostics` shows Stage 27 as the latest applied
      migration
- [ ] `E2E_BASE_URL=https://yourdomain.com npm run test:e2e` — the
      `public` project needs zero setup; `authenticated` needs the
      Supabase test-phone config from `e2e/README.md`
- [ ] Install the PWA on a real phone and confirm it works offline
- [ ] Submit feedback from the app and confirm the notification email
      arrives (if `FEEDBACK_NOTIFICATION_EMAIL` is set)
- [ ] Export your data from the Backups page and confirm the download
      is a valid, complete JSON file

---

## 7. Ongoing operations

- **Turn on Supabase's own automated backups** (Project Settings →
  Database → Backups) — the Stage 27 cron backup is a logical JSON
  export that supplements this; it is not a replacement for real
  point-in-time recovery.
- **Set a spend cap on your AI provider's billing page** — nothing in
  the app enforces a usage ceiling on its own.
- **Set up a Sentry alert rule** (e.g. Slack or email on new issue) —
  errors are captured automatically, but nothing notifies you of them
  until you configure that.
- **Apply future `schema_stageN.sql` files in order** as they're added,
  and check `/dashboard/diagnostics` after each deploy to confirm the
  database has caught up with the code.
- **Rotate `CRON_SECRET`, `ENCRYPTION_KEY`, and any leaked API key**
  immediately if ever exposed — regenerating `ENCRYPTION_KEY`
  specifically will make previously-encrypted OAuth tokens
  undecryptable, so businesses would need to reconnect their cloud
  backup providers after a rotation.
