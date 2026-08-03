# Reseeti — Stage 18: Team Accounts with Roles & Permissions

Takes Stage 8's binary Owner/Staff model and replaces it with five roles
— **Owner, Manager, Cashier, Salesperson, Accountant** — each with its
own permission set.

## The permission matrix

Defined once in `lib/permissions.js`, and used by every page that needs
to gate a feature — nothing checks `role === 'owner'` directly anymore
except two deliberate, documented exceptions (see below).

| Permission | Owner | Manager | Cashier | Salesperson | Accountant |
|---|---|---|---|---|---|
| Create invoice | ✓ | ✓ | ✓ | ✓ | ✗ |
| Delete invoice | ✓ | ✓ | ✗ | ✗ | ✗ |
| Mark invoice paid | ✓ | ✓ | ✓ | ✗ | ✓ |
| Manage customers | ✓ | ✓ | ✓ | ✓ | ✗ |
| Manage inventory | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage expenses | ✓ | ✓ | ✗ | ✗ | ✓ |
| Manage cashbook | ✓ | ✓ | ✓ | ✗ | ✓ |
| View analytics | ✓ | ✓ | ✗ | ✗ | ✓ |
| View reports | ✓ | ✓ | ✗ | ✗ | ✓ |
| Manage team | ✓ | ✓ | ✗ | ✗ | ✗ |
| Manage business settings | ✓ | ✗ | ✗ | ✗ | ✗ |
| Manage subscription | ✓ | ✗ | ✗ | ✗ | ✗ |

This exact table (matching your Cashier example precisely: create ✓,
delete ✗, analytics ✗, subscription ✗) is also rendered live in-app —
tap any role name on the **Team** page to see its permissions before
assigning it to someone.

**Why these specific splits:**
- **Manager** is Owner-minus-two: full daily operations, but not
  branding/tax settings or billing — those stay Owner-only.
- **Cashier** is the front-till role: sells, collects payment, handles
  the day's cash — but can't erase a financial record or see
  business-wide figures.
- **Salesperson** writes invoices and manages customer relationships —
  but doesn't touch cash collection (that's Cashier's job) or see
  business-wide figures.
- **Accountant** sees everything money-related (analytics, reports,
  expenses, cashbook) and can confirm a payment landed — but doesn't
  create sales, and deliberately **can't delete an invoice either**:
  separating "who reconciles the books" from "who can erase what's in
  them" is a basic accounting control, not an oversight.

## What's new to use

- **Team page** — invite with a role (owner/manager pick from
  Manager/Cashier/Salesperson/Accountant; a Manager inviting can't hand
  out Manager), change an existing member's role (Owner only), tap a
  role button to see its full permission breakdown.
- **Delete invoice** — new capability, on the invoice list, visible only
  to Owner/Manager. Didn't exist before this stage.
- Every nav item, button, and page now reflects the signed-in person's
  actual role — a Cashier's sidebar simply doesn't show Analytics,
  Reports, Inventory, Expenses, Team, or Settings; a Salesperson's
  "Mark paid" control is visible but disabled.

## Two deliberate exceptions to "check the matrix, not the role"

1. **Cashbook opening balance** (Stage 13) stays hardcoded to literal
   `role === 'owner'`, not `manageCashbook`. Editing it can retroactively
   shift every running balance in the ledger — a much quieter way to
   paper over a shortfall than any single Cash In/Out entry. Manager has
   `manageCashbook: true` for day-to-day entries, but this one control
   stays narrower on purpose.
2. **Reassigning an existing member's role** (Team page) is restricted to
   the literal owner, not `manageTeam`. A Manager can invite and remove
   people, but not promote someone to Manager or edit anyone's role —
   that's enforced both in the UI and by a database trigger (see below),
   so it holds even against a direct API call.

## Why not full row-level security for every permission

This migration adds real **database-level** enforcement for exactly two
things: **deleting an invoice** (new, destructive, and there was no RLS
restricting it before — technically any active member already could,
there just wasn't a UI button) and **managing team membership** (a
trust-level action, already Owner-only at the DB layer since Stage 8,
now extended to Manager). A trigger also blocks a Manager from
inserting/promoting someone to Manager or Owner, closing off privilege
escalation even via a direct API call.

The other nine permissions (manageCustomers, manageInventory,
manageExpenses, manageCashbook, viewAnalytics, viewReports,
manageSettings, manageSubscription, createInvoice) are enforced at the
**application layer** — which pages render, which buttons appear —
rather than as new row-level-security policies. This is a real scope
decision, not an oversight: most of these are about *which screens
someone can reach*, not *which rows they're allowed to see*, since a
Cashier who can't view Analytics is still looking at the same
`invoices` table a Manager would query to build that page — RLS
governs row visibility, and there's no invoice a Cashier needs to
create/mark-paid that a Manager wouldn't also need to see. Rebuilding
every table's policies around all five roles would be a large amount of
migration surface area for restrictions that are really about UI
navigation, with real risk of a policy bug locking a business out of
its own data. The two enforced above were chosen because they're
destructive/trust-level actions where a UI-only restriction would be a
genuine, exploitable gap — not a workflow inconvenience.

## Setup

### 1. Run the migration
Supabase SQL editor → run `supabase/schema_stage18.sql` (after whichever
stage you're currently on).

Existing `'staff'` members are migrated to `'manager'` automatically —
the closest match to what Stage 8's original Owner/Staff model actually
granted, so nobody loses access they already had. Re-assign them to a
narrower role afterward from the Team page if that's not the right fit.

### 2. Test the full loop
1. As Owner, go to **Team**, tap through each role button and confirm
   the permission table matches the one above.
2. Invite someone as **Cashier**. Log in as them (or check with a second
   test account) and confirm: they can create an invoice and mark it
   paid, but there's no Delete button, and Analytics/Reports/Inventory/
   Expenses/Team/Settings are all missing from the sidebar.
3. Invite someone as **Salesperson** — confirm they can create invoices
   and manage customers, but the paid/unpaid toggle is visible and
   disabled (can't mark paid), and they have no Cashbook access.
4. Invite someone as **Accountant** — confirm they land with no "Create
   Invoice" button anywhere, but do see Analytics, Reports, Expenses,
   and Cashbook, and can mark an invoice paid.
5. As Owner, promote a Cashier to **Manager** — confirm Manager instantly
   gets Inventory/Expenses/Analytics/Reports/Team access, but Settings
   and the Upgrade button stay hidden.
6. Log in as a Manager and confirm the invite-role dropdown does **not**
   offer "Manager" as an option — only Cashier/Salesperson/Accountant.
7. Try deleting an invoice as Owner — confirm it works and cascades
   (invoice_items and invoice_payments for that invoice disappear too).

## What's deliberately left out of this stage
- **No per-member permission overrides** — permissions are entirely
  role-based; there's no "give this one Cashier extra access to
  Analytics" mechanism. A reasonable future addition, but a much bigger
  data model change (per-member permission rows rather than a role
  lookup).
- **No audit log of who did what** — deleting an invoice or changing a
  role doesn't currently record which team member performed the action,
  beyond Supabase's own database logs. Worth adding if this becomes a
  compliance concern.
- **No permission enforcement inside the invoice PDF/email/WhatsApp
  share flows** — those already operate on a single invoice the person
  already has open, so there's no meaningful additional restriction to
  add there beyond "can they view this invoice at all," which every role
  already can for invoices they helped create.
