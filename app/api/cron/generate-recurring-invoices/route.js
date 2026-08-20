import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

function advance(dateStr, frequency) {
  const d = new Date(dateStr);
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// Same CRON_SECRET-protected GET pattern as
// app/api/reminders/send/route.js and
// app/api/subscription/check-expiry/route.js — add this as a third
// crontab entry alongside those two on the VPS. Nothing calls this
// automatically otherwise, for the same reason those two didn't until
// today: this app runs on a plain VPS, not a platform with built-in
// scheduled functions.
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: due } = await admin
    .from('recurring_invoices')
    .select('*')
    .eq('active', true)
    .lte('next_run_date', today);

  let generated = 0, failed = 0;

  for (const template of due || []) {
    const subtotal = (template.items || []).reduce((s, it) => s + Number(it.price) * Number(it.qty), 0);
    const total = Math.max(0, subtotal - Number(template.discount || 0));
    const computedDueDate = template.due_days_after
      ? new Date(Date.now() + template.due_days_after * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null;

    const { data: invoice, error } = await admin
      .from('invoices')
      .insert({
        business_id: template.business_id,
        customer_id: template.customer_id,
        customer_name: template.customer_name,
        customer_phone: template.customer_phone,
        subtotal,
        discount: Number(template.discount || 0),
        total,
        due_date: computedDueDate,
        // Idempotency, same mechanism as the school-fee generator
        // (schema_stage50's generate-invoices route) — keyed by the
        // template id and the specific run date, so this endpoint
        // firing twice for the same day (a duplicate cron trigger, a
        // manual re-run) can't create a second invoice for that date.
        client_ref: `recurring-${template.id}-${template.next_run_date}`,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code !== '23505') failed++; // 23505 = already generated for this date, not a real failure
      continue;
    }

    const itemRows = (template.items || []).map((it, i) => ({
      invoice_id: invoice.id,
      description: it.description,
      qty: it.qty,
      price: it.price,
      sort_order: i,
    }));
    await admin.from('invoice_items').insert(itemRows);

    await admin
      .from('recurring_invoices')
      .update({
        next_run_date: advance(template.next_run_date, template.frequency),
        last_generated_invoice_id: invoice.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', template.id);

    generated++;
  }

  return NextResponse.json({ checked: (due || []).length, generated, failed });
}
