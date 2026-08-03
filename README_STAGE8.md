# Reseeti — Stage 8: Multi-user staff accounts

Up to now, one login = one business, full stop. This stage breaks that
assumption on purpose: a business owner can now invite staff (by phone
number) who log into the exact same Reseeti account data — invoices,
customers, inventory — without sharing the owner's own login.

## How inviting works

1. Owner goes to **Team** in the sidebar (only owners see this nav item)
   and clicks **Invite staff**, entering the staff member's phone number
   and, optionally, a name/role label just for the owner's own reference.
2. This creates a `business_members` row with `status = 'invited'` and no
   `user_id` yet — there's nothing for the staff member to click or accept
   from their end.
3. **The owner needs to separately tell that person to log into Reseeti** —
   inviting doesn't send an SMS or notification of any kind. This is a
   deliberate scope cut, not an oversight — see "What's left out" below.
4. When that phone number logs in via the normal OTP flow (same login
   page everyone uses), the signup trigger checks for a pending invite
   matching that phone number. If found, it attaches them to the existing
   business instead of creating a new one — completely invisible to the
   person logging in; they just land on the dashboard like anyone else.

## Permission model

| Action | Owner | Staff |
|---|---|---|
| Create/edit invoices, customers, products | ✅ | ✅ |
| View payments, analytics, reports | ✅ | ✅ |
| Edit business settings (name, logo, address) | ✅ | ❌ |
| Invite / remove team members | ✅ | ❌ |
| Start or manage the Pro subscription | ✅ | ❌ |

The reasoning: staff need full operational access to actually do the job
(sell things, invoice customers, manage stock) and benefit from seeing
the same financial visibility the owner has (nothing here is sensitive in
a way that needs hiding from staff who already handle real cash). What's
restricted is specifically *account-level* control — who has access, how
the business is branded, and where money for the subscription itself
comes from.

**This is enforced at two levels, not just one:**
- **Database (RLS)** — `businesses` UPDATE, and all `business_members`
  writes, are restricted to the owner at the Postgres level. Even a bug in
  the frontend that showed a staff member an edit button couldn't actually
  let the write through.
- **API routes** — the three payment-initialize routes
  (`paystack`/`opay`/`monnify`) explicitly check `role === 'owner'` and
  return a 403 otherwise. This matters because *starting* a subscription
  isn't a database write RLS can intercept — it's an outbound call to a
  payment gateway. RLS alone wouldn't have stopped a staff member from
  triggering that if the button were merely hidden in the UI rather than
  actually blocked server-side.

## What changed, file by file

**New:**
- `supabase/schema_stage8.sql` — the `business_members` table, the
  rebuilt RLS policies, and the replacement signup trigger
- `lib/getMyBusiness.js` — client-side "resolve my business + role"
  helper, now used by every dashboard page instead of each having its own
  `businesses.user_id` lookup
- `app/dashboard/team/page.js` — the invite/remove UI

**Changed:**
- `lib/supabaseServer.js` — added `getMyBusinessId()`, the server-side
  counterpart used by API routes
- `app/api/paystack/initialize/route.js`, `app/api/opay/initialize/route.js`,
  `app/api/monnify/initialize/route.js` — now resolve business via
  membership and reject non-owners with a 403
- `app/api/payments/history/route.js` — resolves via membership too, but
  allows any active member (viewing history isn't a billing action)
- `app/dashboard/page.js` — uses `getMyBusiness()`, tracks `role`, hides
  the Settings gear and Upgrade button for staff, and shows staff a
  different message ("ask the owner") instead of an upgrade button when
  the free tier limit is hit
- `app/dashboard/Sidebar.jsx` — adds the **Team** nav item (owner-only),
  hides the "Upgrade to Pro" sidebar button for staff
- `app/dashboard/DashboardShell.jsx` — threads the new `role` prop down
  to `Sidebar`
- `app/dashboard/customers/page.js`, `customers/[id]/page.js`,
  `inventory/page.js`, `payments/page.js`, `reports/page.js`,
  `analytics/page.js` — all six swapped their business lookup to
  `getMyBusiness()`. No other logic in these files changed.

**Untouched:**
- `InvoiceForm.jsx`, `ProductForm.jsx`, `BusinessSettings.jsx` — these
  already received `business` as a prop rather than looking it up
  themselves, so they needed no changes at all.
- Every webhook route, `lib/offlineQueue.js`, `lib/analytics.js`,
  `lib/paystack.js` / `opay.js` / `monnify.js` — unaffected.

## Setup

### 1. Run the migration
Supabase SQL editor → run `supabase/schema_stage8.sql` (after
`schema_stage6.sql`; Stage 7's OPay/Monnify work added no schema, so this
follows directly after Stage 6's tables).

**Read the backfill step in the migration before running it in
production** — it gives every *existing* business owner an `'owner'`
membership row so the RLS rebuild doesn't lock anyone out. This is safe to
run once; running it again is harmless (it's an `insert ... where not
exists`), but there's no reason to run it twice.

### 2. Install and run
No new dependencies:
```
npm install
npm run dev
```

### 3. Test the full loop
1. As the owner, go to **Team**, invite a phone number you can actually
   log into (a second phone, or the same phone with a different test
   number if your Twilio/SMS setup allows it).
2. Log out, log in as that number via the normal login page.
3. Confirm you land on the dashboard with the *same* business data — same
   invoices, same business name — not a fresh "My Business."
4. Confirm the sidebar for that staff login does **not** show "Team," and
   that Settings/Upgrade buttons are absent.
5. Try creating an invoice as staff — should work identically to the
   owner.
6. Back on the owner's login, go to Team and remove that staff member.
   Confirm they lose access on their next page load (RLS blocks the
   membership immediately; their session just won't return data anymore).

## What's deliberately left out of this stage

- **No invite notification.** The owner has to separately message the
  staff member (WhatsApp, a phone call, whatever) telling them to log in.
  Automating this would mean sending an SMS at invite time, which needs
  its own Twilio setup decision (a second message type, cost per invite)
  — reasonable to add once real usage shows it's actually the friction
  point, rather than building it speculatively now.
- **No granular staff permissions.** It's a flat owner/staff split, not
  "this staff member can see Payments but not Reports." Fine for a small
  shop with one or two staff; would need real rework for anything larger.
- **No audit log of who did what.** If two staff and an owner all use the
  same business, there's currently no record of which login created or
  edited a given invoice. Worth adding (a `created_by` column on invoices,
  already partially possible since `invoice_items` inserts happen through
  an authenticated session) if accountability between staff becomes a
  real question.
- **Removing a member doesn't handle their pending offline queue.** If a
  staff member is offline, creates draft invoices locally, and is removed
  from the team before reconnecting, their local queue will fail to sync
  (RLS will reject the insert) and stay stuck pending in their browser's
  local storage. Edge case, but worth knowing about rather than being
  surprised by it.
