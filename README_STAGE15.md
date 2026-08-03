# Reseeti — Stage 15: Platform admin panel

A new `/admin` section for Reseeti's own team — separate from the
business-owner-facing `/dashboard`, which stays scoped to one business at
a time no matter who's using it.

## What's in it

- **Overview** (`/admin`) — platform-wide stats: total businesses, Pro vs
  Free split, estimated MRR, signups this week/month, total invoices,
  total revenue processed across every business.
- **Businesses** (`/admin/businesses`) — every business, searchable by
  name/phone/email, showing plan and invoices used this month.
- **Business detail** (`/admin/businesses/{id}`) — that business's own
  stats, plus the override form: switch their plan (Free/Pro), set a Pro
  renewal date, and optionally give them a custom monthly invoice limit
  that overrides the platform default.
- **Admins** (`/admin/admins`) — see who currently has admin access, add
  someone by their Supabase User UID, remove someone (blocked from
  removing the very last admin, so nobody can lock everyone out by
  accident).
- **Settings** (`/admin/settings`) — the platform-wide default free-plan
  monthly invoice limit (previously a hardcoded `5` in
  `app/dashboard/page.js`; now a real, editable number).

## Why "who can access this" needed its own table

`business_members` (from Stage 8) already has an owner/staff role — but
that's roles *within one business*. Platform admin is a different kind of
access entirely (across *every* business), so it gets its own table,
`platform_admins`, with **no client-facing RLS policies at all**. That's
deliberate: it means the normal signed-in client can never read or write
that table under any circumstances, regardless of what role a user has
elsewhere — only server-side code using the service-role admin client can
touch it, and only after independently confirming (via
`lib/getPlatformAdmin.js`) that the request is even coming from a signed-in
user in the first place.

Every `/admin/*` page and `/api/admin/*` route re-checks this
independently — the layout's check keeps a non-admin from ever rendering
the pages, and each API route checks again itself (never trusting that a
request reaching it must have come through the layout).

## Bootstrapping your first admin

There's intentionally no self-serve signup for this — the very first admin
has to be added by hand:

1. Sign in to Reseeti normally once (so you have an `auth.users` row).
2. In the Supabase dashboard, go to Authentication → Users, find yourself,
   and copy your **User UID**.
3. In the SQL editor, run:
   ```sql
   insert into platform_admins (user_id, label) values ('<your-user-uid>', 'Founder');
   ```
4. Visit `/admin` — you're in. From here on, you can add further admins
   from the Admins page itself rather than needing SQL again.

## How the invoice limit override actually applies

`app/dashboard/page.js` used to have a hardcoded `const FREE_LIMIT = 5`.
Now:
- `platform_settings.free_plan_invoice_limit` is the platform-wide default
  (editable from `/admin/settings`), readable by any signed-in business
  (the number itself isn't sensitive — every dashboard needs to know its
  own limit).
- `businesses.monthly_invoice_limit` is `null` for virtually every
  business, meaning "use the platform default." An admin can set it to a
  specific number for one business from that business's detail page — the
  business's own dashboard picks that up automatically (`business.monthly_invoice_limit ?? platformFreeLimit`).

## Schema changes — run `supabase/schema_stage15.sql`

Adds `platform_admins` and `platform_settings` (both RLS-enabled, the
latter with one public-read policy for the limit number), plus
`businesses.monthly_invoice_limit`.

## Known limitations worth knowing about

- The Businesses list and Overview stats fetch *all* businesses/invoices
  in one request rather than paginating — completely fine at hundreds of
  businesses, but would want real pagination/aggregate queries if Reseeti
  grows into the thousands.
- Adding an admin requires finding their User UID manually in the Supabase
  dashboard, rather than searching by phone/email in the panel itself —
  simpler and more reliable to build than wiring up admin-user search,
  and totally fine at "small team" scale, but worth revisiting if admin
  additions become frequent.
