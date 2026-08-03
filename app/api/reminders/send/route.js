import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { sendSms, toE164 } from '../../../../lib/twilioSms';
import { sendWhatsAppTemplate } from '../../../../lib/whatsapp';

export const dynamic = 'force-dynamic';

// The exact template name/structure the Meta Business Manager template
// must be approved with — {{1}} customer first name, {{2}} invoice
// number, {{3}} amount, {{4}} payment link. Overridable per-deployment
// since template names are chosen at approval time in Meta's console,
// not something this app controls. See README_STAGE24.md.
const WHATSAPP_REMINDER_TEMPLATE = process.env.WHATSAPP_REMINDER_TEMPLATE_NAME || 'invoice_reminder';

// Sends (or re-sends) reminders for every qualifying unpaid invoice on one
// business, over whichever channel(s) that business has turned on.
// Shared by both the cron path and the manual-trigger path below so the
// actual eligibility rule and message only exist in one place.
async function sendRemindersForBusiness(admin, business) {
  const daysAfter = business.reminder_days_after || 3;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysAfter);

  const { data: invoices } = await admin
    .from('invoices')
    .select('id, invoice_number, customer_name, customer_phone, total, created_at, last_reminder_sent_at')
    .eq('business_id', business.id)
    .eq('paid', false)
    .not('customer_phone', 'is', null)
    .lte('created_at', cutoff.toISOString());

  let sent = 0;
  let failed = 0;

  for (const inv of invoices || []) {
    // Re-reminding uses the same days-after gap as the initial reminder —
    // an invoice unpaid for a month gets nudged periodically, not spammed
    // daily and not silently forgotten after one try.
    if (inv.last_reminder_sent_at) {
      const lastSent = new Date(inv.last_reminder_sent_at);
      if (lastSent > cutoff) continue;
    }

    const firstName = (inv.customer_name || 'Customer').trim().split(/\s+/)[0];
    const link = `${process.env.NEXT_PUBLIC_APP_URL}/inv/${inv.id}`;
    const amount = `NGN ${Number(inv.total).toLocaleString('en-NG')}`;

    // Both channels are attempted independently — a business with both
    // turned on gets both messages, and one channel failing (bad number
    // format for SMS, template not yet approved for WhatsApp) doesn't
    // block the other from going out for the same invoice.
    let anySucceeded = false;
    let lastError = null;

    if (business.sms_reminders_enabled) {
      try {
        const message = `Dear ${firstName}, Invoice ${inv.invoice_number} remains unpaid. Amount: ${amount}. View & pay: ${link}`;
        await sendSms({ to: toE164(inv.customer_phone), body: message });
        await admin.from('events').insert({
          business_id: business.id,
          event_type: 'sms_reminder_sent',
          metadata: { invoice_id: inv.id, invoice_number: inv.invoice_number },
        });
        anySucceeded = true;
      } catch (err) {
        lastError = err;
        await admin.from('events').insert({
          business_id: business.id,
          event_type: 'sms_reminder_failed',
          metadata: { invoice_id: inv.id, error: err.message },
        }).then(() => {}).catch(() => {});
      }
    }

    if (business.whatsapp_reminders_enabled) {
      try {
        await sendWhatsAppTemplate({
          to: inv.customer_phone,
          templateName: WHATSAPP_REMINDER_TEMPLATE,
          params: [firstName, inv.invoice_number, amount, link],
        });
        await admin.from('events').insert({
          business_id: business.id,
          event_type: 'whatsapp_reminder_sent',
          metadata: { invoice_id: inv.id, invoice_number: inv.invoice_number },
        });
        anySucceeded = true;
      } catch (err) {
        lastError = err;
        await admin.from('events').insert({
          business_id: business.id,
          event_type: 'whatsapp_reminder_failed',
          metadata: { invoice_id: inv.id, error: err.message },
        }).then(() => {}).catch(() => {});
      }
    }

    // last_reminder_sent_at (and the sent/failed tally below) is judged
    // per-invoice, not per-channel — if at least one enabled channel got
    // through, this invoice counts as reminded and won't be re-attempted
    // until the next cutoff window.
    if (anySucceeded) {
      await admin.from('invoices').update({ last_reminder_sent_at: new Date().toISOString() }).eq('id', inv.id);
      sent++;
    } else if (lastError) {
      failed++;
    }
  }

  return { sent, failed, checked: (invoices || []).length };
}

// GET — the path Vercel Cron actually invokes on schedule (see
// vercel.json). Processes every business with SMS and/or WhatsApp
// reminders enabled. Protected by CRON_SECRET, which Vercel automatically
// sends as a Bearer token on cron-triggered requests — see
// README_STAGE16.md for why this specific check is what keeps this
// endpoint from being triggerable by anyone who finds the URL.
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: businesses } = await admin
    .from('businesses')
    .select('id, reminder_days_after, sms_reminders_enabled, whatsapp_reminders_enabled')
    .or('sms_reminders_enabled.eq.true,whatsapp_reminders_enabled.eq.true');

  const results = [];
  for (const biz of businesses || []) {
    const result = await sendRemindersForBusiness(admin, biz);
    results.push({ business_id: biz.id, ...result });
  }

  const totals = results.reduce((acc, r) => ({ sent: acc.sent + r.sent, failed: acc.failed + r.failed }), { sent: 0, failed: 0 });
  return NextResponse.json({ businesses: results.length, ...totals, results });
}

// POST — an owner manually clicking "Send reminders now" from the
// dashboard. Uses the caller's own session, scoped to only their business
// via the normal membership lookup — no CRON_SECRET involved, and no
// access to any other business's data.
export async function POST() {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }
  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only the business owner can trigger reminders.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: business } = await admin
    .from('businesses')
    .select('id, reminder_days_after, sms_reminders_enabled, whatsapp_reminders_enabled')
    .eq('id', membership.businessId)
    .single();

  if (!business?.sms_reminders_enabled && !business?.whatsapp_reminders_enabled) {
    return NextResponse.json({ error: 'SMS and WhatsApp reminders are both turned off in Business Settings.' }, { status: 400 });
  }

  const result = await sendRemindersForBusiness(admin, business);
  return NextResponse.json(result);
}
