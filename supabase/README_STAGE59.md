# Stage 59 — Void invoice (+ payment refunds)

## Deploy order — this matters

1. **Run `schema_stage59.sql` in the Supabase SQL editor FIRST.**
2. Then deploy the app code.

The app now selects `voided_at` in many queries. If the new code is live before
the migration has run, those queries fail (column does not exist) and the
dashboard, analytics, reports and customer pages will error. The migration is
safe to run more than once.

After running it, `/dashboard/diagnostics` should show version 59.

## The rules (as specified)

- **Who can void:** the owner, or a manager. Implemented as a new permission,
  `voidInvoice` (`lib/permissions.js`): owner always, manager by default,
  everyone else off. It honours per-member overrides (Stage 28), so an owner can
  withdraw it from one manager or grant it to a trusted cashier on the Team page.
  The database enforces this too (`can_void_invoices()`), not just the UI.
- **Payments block voiding.** An invoice that holds payments cannot be voided
  until they are refunded. Legacy invoices flagged *paid* with no payment rows
  must be marked unpaid first (existing PAID button).
- **A void never deletes anything.** The invoice stays in every list, marked
  VOID, with who voided it, when, why, and optional notes.

## What a void does

- Restores stock for every non-service product on the invoice (serialized
  products included — it mirrors `deduct_stock_on_sale()` exactly), with
  `stock_movements` rows (`reason = 'void'`) so "why is my stock X" still answers.
- Makes any serialized unit sellable again. Unit "sold" status is *derived* from
  `invoice_items`, so the item rows are kept (the Serial/IMEI lookup still shows
  the voided sale) and the three places that derive "sold" now ignore voided
  invoices.
- Writes an `invoice_voided` event, shown on the owner's Activity & Audit page.

## Refunds (new — required by the rule above)

The cloud app had no refund mechanism (`invoice_payments.amount` must be > 0 and
nothing reversed a payment), so "refund first" would have been a dead end.
`refund_invoice_payment()` is the minimum needed:

- Same authority as voiding. Reason required.
- The payment is **archived** into `invoice_payment_refunds` (append-only: members
  can read it, nobody can edit or delete rows through the API) and then removed
  from `invoice_payments`. Every existing report that sums payments stays correct
  with no changes.
- If that drops the invoice below its total, it is marked unpaid (same reset the
  existing "mark as unpaid" action does).
- It records that money was handed back. It does not move money.
- Allowed on already-voided invoices, so a late online payment can still be
  returned and recorded.

## Where voided invoices are excluded

Dashboard totals and counts · Analytics · Reports/exports · Customers list and
statements (a voided invoice is not a debt) · School fee collection · AI
insights · payment reminders (SMS/WhatsApp) · online pay-balance · emailing and
customer-signing an invoice.

Shown but marked: dashboard invoice list · public receipt (VOID stamp, banner,
payment options hidden) · `/verify/<code>` (**no longer says "Genuine receipt"**
for a voided invoice).

Deliberately **not** excluded: the free-plan monthly invoice meter. The database
trigger that enforces the limit counts every invoice created, voided or not, and
the meter shows the same number the trigger sees.

## Security

Invoices are updatable by any active member through RLS, so the void columns are
protected by a trigger: they can only change inside `void_invoice()`. A raw API
call cannot forge a void, change a reason, or un-void.

## Known gaps — not changed here

1. **Hard Delete still exists, and does not restore stock.** There is no
   delete-side trigger, so deleting an invoice leaves its stock permanently
   deducted. The Delete button is now hidden on voided invoices. Consider
   whether Delete should remain at all now that Void exists.
2. **Any active member can delete `invoice_payments` rows through the API**
   (the Stage 15 policy is `for all`). The refund function is the audited path,
   but it is not the only one. Worth tightening.
3. **Late online payments.** If a customer's online payment lands after the
   invoice is voided, the webhook still records it (dropping real money would be
   worse). The invoice then shows VOID with a payment on it; refund it from the
   void dialog's payment list.
4. **Clinic / Lab / Construction / Hotel / School** create invoices from visits,
   orders, bookings and milestones. Voiding the invoice does not un-invoice
   those source records. Not examined.
5. `my_active_manager_business_ids()` is used by the Stage 41 invoice-delete
   policy but is not defined in any migration in the repo. It presumably exists
   because it was created by hand. Stage 59 does not depend on it.
6. `app/api/verify/[code]/page.js` is a duplicate of `app/verify/[code]/page.js`
   and is publicly reachable at `/api/verify/<code>`. Both are patched; one
   should probably be deleted.
