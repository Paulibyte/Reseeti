import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { timingSafeEqualHex } from '../../../../lib/crypto';

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

  switch (event.event) {
    case 'charge.success': {
      const businessId = event.data.metadata?.business_id;
      const customerCode = event.data.customer?.customer_code;
      const subscriptionCode = event.data.plan_object?.plan_code
        ? event.data.subscription_code
        : null;

      // A month of grace by default; Paystack's own renewal webhook events
      // will push this forward again on each successful recurring charge.
      const renewsAt = new Date();
      renewsAt.setDate(renewsAt.getDate() + 30);

      if (businessId) {
        await supabase
          .from('businesses')
          .update({
            plan: 'pro',
            plan_renews_at: renewsAt.toISOString(),
            // A successful charge means this business is current again —
            // clears any grace period started by the check-expiry cron
            // if the previous charge attempt had failed.
            plan_grace_until: null,
            paystack_customer_code: customerCode,
            paystack_subscription_code: subscriptionCode,
          })
          .eq('id', businessId);

        await supabase.from('events').insert({
          business_id: businessId,
          event_type: 'upgrade_completed',
          metadata: { reference: event.data.reference },
        });
      }
      break;
    }

    // Fired when a recurring charge fails (expired card, insufficient funds).
    // Don't downgrade instantly on the first failure — Paystack retries
    // automatically over a few days. Only act on the explicit "we've given
    // up" event below.
    case 'invoice.payment_failed': {
      break;
    }

    // Fired when a subscription is fully cancelled/disabled.
    case 'subscription.disable': {
      const subscriptionCode = event.data.subscription_code;
      if (subscriptionCode) {
        await supabase
          .from('businesses')
          .update({ plan: 'free' })
          .eq('paystack_subscription_code', subscriptionCode);
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
