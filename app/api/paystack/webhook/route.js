import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { timingSafeEqualHex } from '../../../../lib/crypto';
import { renewsAtForMonths, getTier } from '../../../../lib/planTiers';

// Paystack signs every webhook body with your secret key so you can trust
// it actually came from them and not someone hitting your endpoint directly
// to grant themselves a free Pro upgrade.
function isValidSignature(rawBody, signatureHeader) {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return timingSafeEqualHex(hash, signatureHeader);
}

export async function POST(request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');

  if (!signature || !isValidSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const supabase = createAdminClient();

  await supabase.from('payment_events').insert({
    event_type: event.event,
    reference: event.data?.reference,
    amount: event.data?.amount ? event.data.amount / 100 : null,
    raw_payload: event,
  });

  // Only 'charge.success' matters now — Reseeti's 3 tiers (see
  // lib/planTiers.js) are each a one-off charge, not a Paystack
  // recurring Plan/subscription, so the invoice.payment_failed and
  // subscription.disable events that used to matter for the old
  // ₦1,500/month auto-renewing Plan no longer apply: there's no
  // subscription for Paystack to retry or disable. A business simply
  // gets prompted to pay again once plan_renews_at passes (see the
  // check-expiry cron), same model OPay and Monnify already use.
  if (event.event === 'charge.success') {
    const businessId = event.data.metadata?.business_id;
    const tier = event.data.metadata?.tier;
    const customerCode = event.data.customer?.customer_code;
    const paymentType = event.data.metadata?.payment_type;
    const invoiceId = event.data.metadata?.invoice_id;
    const discountApplied = event.data.metadata?.discount_applied === true;

    if (businessId && tier) {
      const tierRow = await getTier(tier);
      if (tierRow) {
        await supabase
          .from('businesses')
          .update({
            plan: 'pro',
            plan_interval: tier,
            plan_renews_at: renewsAtForMonths(tierRow.months).toISOString(),
            // A successful charge means this business is current again —
            // clears any grace period started by the check-expiry cron
            // if the previous charge attempt had failed.
            plan_grace_until: null,
            paystack_customer_code: customerCode,
          })
          .eq('id', businessId);

        await supabase.from('events').insert({
          business_id: businessId,
          event_type: 'upgrade_completed',
          metadata: { reference: event.data.reference, tier },
        });

        // Referral discount actually being spent — only decrement now
        // that the discounted payment has genuinely gone through, not
        // at initialize time when the person may never complete
        // checkout at all. Read-then-write rather than a raw
        // decrement expression; a business paying for its own
        // subscription isn't a high-concurrency path, so this is safe.
        if (discountApplied) {
          const { data: biz } = await supabase
            .from('businesses')
            .select('available_referral_discounts')
            .eq('id', businessId)
            .single();
          const remaining = Math.max(0, (biz?.available_referral_discounts || 0) - 1);
          await supabase.from('businesses').update({ available_referral_discounts: remaining }).eq('id', businessId);
        }

        // Referral qualification — only for the annual tier (matching
        // the promo's own terms), and only the first time: a referral
        // row is unique per referred_business_id, and this only ever
        // touches one still in 'pending'. Whoever referred this
        // business earns one future discount, credited here rather
        // than at signup, since qualification was deliberately
        // designed to require a real annual payment, not just a
        // sign-up.
        if (tierRow.months === 12) {
          const { data: referral } = await supabase
            .from('referrals')
            .select('id, referrer_business_id')
            .eq('referred_business_id', businessId)
            .eq('status', 'pending')
            .maybeSingle();

          if (referral) {
            await supabase
              .from('referrals')
              .update({ status: 'qualified', qualified_at: new Date().toISOString() })
              .eq('id', referral.id);

            const { data: referrer } = await supabase
              .from('businesses')
              .select('available_referral_discounts')
              .eq('id', referral.referrer_business_id)
              .single();
            await supabase
              .from('businesses')
              .update({ available_referral_discounts: (referrer?.available_referral_discounts || 0) + 1 })
              .eq('id', referral.referrer_business_id);
          }
        }
      }
    } else if (paymentType === 'invoice_installment' && invoiceId) {
      // A customer paying part of any unpaid invoice online (see
      // app/api/invoices/pay-balance/route.js, which set this metadata
      // when the transaction was initialized — originally school-fee-
      // only, generalized once the need turned out not to be
      // school-specific). Recording a plain invoice_payments row here
      // is deliberately the ONLY thing this branch does — it's the
      // exact same insert staff already make via "Record payment" on
      // the customer page, so whatever logic already marks an invoice
      // fully paid once payments cover the total keeps working
      // unchanged; there's no separate "mark paid" step to duplicate
      // or get out of sync.
      await supabase.from('invoice_payments').insert({
        invoice_id: invoiceId,
        method: 'card',
        amount: event.data.amount / 100,
      });

      const { data: inv } = await supabase.from('invoices').select('business_id').eq('id', invoiceId).maybeSingle();
      await supabase.from('events').insert({
        business_id: inv?.business_id || null,
        event_type: 'invoice_installment_paid',
        metadata: { reference: event.data.reference, invoice_id: invoiceId, amount: event.data.amount / 100 },
      });
    }
  }

  return NextResponse.json({ received: true });
}
