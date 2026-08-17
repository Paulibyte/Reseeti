import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { sendSms, toE164 } from '../../../../lib/twilioSms';

export const dynamic = 'force-dynamic';

const GRACE_DAYS = 7;

// Why this needs its own cron rather than just relying on webhooks:
// webhooks only tell you about payment *attempts* (success, failure,
// explicit cancellation) — they never fire for the case where a
// business's card silently stops being charged at all (an expired card
// with no retry configured on the gateway's side, a Paystack
// subscription that quietly lapsed without ever sending
// `subscription.disable`, or an OPay/Monnify one-time "renewal" nobody
// came back to pay). Those businesses would stay marked `plan = 'pro'`
// forever without this: a scheduled check of "has plan_renews_at
// actually passed" is the only way to catch that.
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();

  // ---------- Step 1: start grace for anyone who just lapsed ----------
  // A Pro business whose renewal date has passed and has no grace period
  // recorded yet gets one started now — plan stays 'pro' throughout
  // grace (see README_STAGE26.md: Pro features keep working during the 7
  // days, which is the entire point of a grace period), so this step is
  // pure bookkeeping plus a heads-up nudge, not a downgrade.
  const { data: justLapsed } = await admin
    .from('businesses')
    .select('id, name, phone')
    .eq('plan', 'pro')
    .is('plan_grace_until', null)
    .lt('plan_renews_at', now.toISOString());

  for (const biz of justLapsed || []) {
    const graceUntil = new Date(now);
    graceUntil.setDate(graceUntil.getDate() + GRACE_DAYS);

    await admin.from('businesses').update({ plan_grace_until: graceUntil.toISOString() }).eq('id', biz.id);
    await admin.from('events').insert({
      business_id: biz.id,
      event_type: 'subscription_grace_started',
      metadata: { grace_until: graceUntil.toISOString() },
    });

    if (biz.phone) {
      try {
        await sendSms({
          to: toE164(biz.phone),
          body: `Reseeti: your Pro subscription payment didn't go through. You have ${GRACE_DAYS} days to update payment before your account reverts to the Free plan.`,
        });
      } catch (err) {
        console.error('Grace-period notice SMS failed:', err.message);
      }
    }
  }

  // ---------- Step 2: downgrade anyone whose grace period is over ----------
  const { data: graceExpired } = await admin
    .from('businesses')
    .select('id, phone')
    .eq('plan', 'pro')
    .not('plan_grace_until', 'is', null)
    .lt('plan_grace_until', now.toISOString());

  for (const biz of graceExpired || []) {
    await admin.from('businesses').update({
      plan: 'free',
      plan_grace_until: null,
      // Otherwise Settings would keep showing the catalogue as "on"
      // (catalogue_enabled stays true) even though the public /shop
      // page already independently checks plan === 'pro' and refuses
      // to serve — cosmetic-but-confusing, not a security gap, but no
      // reason to leave it inconsistent once a business is genuinely
      // downgraded. Re-enabling later (once back on Pro) reuses the
      // same slug — see app/api/catalogue/enable/route.js.
      catalogue_enabled: false,
    }).eq('id', biz.id);

    await admin.from('events').insert({
      business_id: biz.id,
      event_type: 'subscription_expired_downgraded',
      metadata: {},
    });

    if (biz.phone) {
      try {
        await sendSms({
          to: toE164(biz.phone),
          body: `Reseeti: your grace period has ended and your account is now on the Free plan. Upgrade any time from the Payments page to restore Pro features.`,
        });
      } catch (err) {
        console.error('Downgrade notice SMS failed:', err.message);
      }
    }
  }

  return NextResponse.json({
    graceStarted: (justLapsed || []).length,
    downgraded: (graceExpired || []).length,
  });
}
