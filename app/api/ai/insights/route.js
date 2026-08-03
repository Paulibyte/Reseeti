import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { callClaude, parseJSONResponse, MODELS } from '../../../../lib/anthropic';

const CACHE_HOURS = 24;

// GET returns whatever's cached (see schema_stage22.sql's
// businesses.ai_insights / ai_insights_generated_at) without calling the
// AI at all — cheap, instant, and what the dashboard/analytics page
// calls on every normal load. A fresh business with nothing cached yet
// gets stale: true, no insights, so the UI can show a "Generate
// insights" call to action instead of an empty section.
export async function GET() {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('ai_insights, ai_insights_generated_at')
    .eq('id', membership.businessId)
    .single();

  const generatedAt = business?.ai_insights_generated_at;
  const stale = !generatedAt || (Date.now() - new Date(generatedAt).getTime()) > CACHE_HOURS * 60 * 60 * 1000;

  return NextResponse.json({
    insights: business?.ai_insights || null,
    generatedAt: generatedAt || null,
    stale,
  });
}

// POST actually calls Claude and refreshes the cache — either the
// dashboard's "Generate insights" button on first use, or a "Refresh"
// button once CACHE_HOURS has passed. Deliberately never triggered
// automatically on every page load: a business's numbers don't change
// meaningfully minute-to-minute, and every call here costs real money.
export async function POST() {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }

  const admin = createAdminClient();
  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Aggregated, bounded numbers only — this route never hands Claude a
  // raw dump of every invoice/customer row (unbounded size, and
  // customer names/phone numbers aren't needed to say "sales are down
  // 23%"). Everything below is either a count, a sum, or a small
  // top-N list.
  const [{ data: invoices }, { data: products }, { data: expenses }] = await Promise.all([
    admin
      .from('invoices')
      .select('total, paid, created_at, customer_name')
      .eq('business_id', membership.businessId)
      .gte('created_at', since.toISOString()),
    admin
      .from('products')
      .select('name, stock_qty, low_stock_threshold')
      .eq('business_id', membership.businessId),
    admin
      .from('expenses')
      .select('category, amount, expense_date')
      .eq('business_id', membership.businessId)
      .gte('expense_date', since.toISOString().slice(0, 10)),
  ]);

  if (!invoices || invoices.length < 5) {
    return NextResponse.json({ error: 'Not enough sales history yet — insights need at least a handful of invoices to say anything meaningful.' }, { status: 422 });
  }

  const summary = buildSummary(invoices, products || [], expenses || []);

  const system = `You are a business analyst for a small Nigerian retail/trade business, looking at their own sales, inventory, and expense data from the last 90 days. Write 3-5 short, specific, actionable insights — the kind a sharp accountant would mention in passing, not generic advice. Base every insight strictly on the numbers given; never invent a figure or claim you don't have data for. Prefer concrete numbers over vague language ("sales are down 23% vs the prior 30 days" beats "sales have declined").

Data (all figures in NGN):
${JSON.stringify(summary)}

Respond with ONLY a JSON object, no markdown fences, no other text, in exactly this shape:
{"insights": [{"icon": string (one emoji), "text": string (one sentence, under 140 characters)}]}`;

  try {
    const raw = await callClaude({
      model: MODELS.REASONING,
      system,
      messages: [{ role: 'user', content: 'Generate the insights.' }],
      maxTokens: 700,
    });
    const parsed = parseJSONResponse(raw);
    if (!Array.isArray(parsed.insights) || parsed.insights.length === 0) {
      throw new Error('Model returned no insights');
    }

    const generatedAt = new Date().toISOString();
    await admin
      .from('businesses')
      .update({ ai_insights: parsed.insights, ai_insights_generated_at: generatedAt })
      .eq('id', membership.businessId);

    return NextResponse.json({ insights: parsed.insights, generatedAt, stale: false });
  } catch (err) {
    console.error('AI insights generation failed:', err);
    return NextResponse.json({ error: 'Could not generate insights right now — try again shortly.' }, { status: 500 });
  }
}

// Turns raw rows into the compact, pre-computed shape Claude actually
// needs — the model is good at spotting patterns in numbers we hand it,
// not at doing the aggregation itself reliably, so the split-by-week
// sales trend, per-product totals, and day-of-week breakdown are all
// computed here in plain JS rather than asked of the model.
function buildSummary(invoices, products, expenses) {
  const now = Date.now();
  const last30 = invoices.filter((i) => now - new Date(i.created_at).getTime() <= 30 * 24 * 60 * 60 * 1000);
  const prior30 = invoices.filter((i) => {
    const age = now - new Date(i.created_at).getTime();
    return age > 30 * 24 * 60 * 60 * 1000 && age <= 60 * 24 * 60 * 60 * 1000;
  });

  const sum = (rows) => rows.reduce((s, r) => s + Number(r.total || 0), 0);

  const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0];
  invoices.forEach((i) => { dayOfWeekCounts[new Date(i.created_at).getDay()]++; });
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const lowStock = products
    .filter((p) => Number(p.stock_qty) > 0 && Number(p.stock_qty) <= Number(p.low_stock_threshold))
    .map((p) => ({ name: p.name, stock_qty: p.stock_qty }));

  const expenseByCategory = {};
  expenses.forEach((e) => { expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + Number(e.amount || 0); });

  const customerFrequency = {};
  invoices.forEach((i) => { customerFrequency[i.customer_name] = (customerFrequency[i.customer_name] || 0) + 1; });
  const repeatCustomers = Object.entries(customerFrequency).filter(([, count]) => count > 1).length;

  return {
    last_30_days_revenue: sum(last30),
    prior_30_days_revenue: sum(prior30),
    last_30_days_invoice_count: last30.length,
    prior_30_days_invoice_count: prior30.length,
    unpaid_total: sum(invoices.filter((i) => !i.paid)),
    unique_customers_90d: Object.keys(customerFrequency).length,
    repeat_customers_90d: repeatCustomers,
    invoices_by_day_of_week: dayNames.map((name, i) => ({ day: name, count: dayOfWeekCounts[i] })),
    low_stock_products: lowStock,
    expense_by_category_90d: expenseByCategory,
  };
}
