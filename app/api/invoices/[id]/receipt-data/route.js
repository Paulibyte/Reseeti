import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../../lib/supabaseAdmin';
import { computeReceiptSignature } from '../../../../../lib/receiptSignature';

// Deliberately public — same as the page it was extracted from
// (app/inv/[id]/page.js used to do this fetch during server rendering).
// Moved here so /inv/[id] can become a client component that fetches its
// own data instead of requiring Next.js's server to run on every single
// visit — the actual reason offline access was structurally impossible
// before this. The signing secret still never reaches the browser: it's
// used here, server-side, exactly as before, just returned as a
// pre-computed value in the JSON response instead of being embedded
// during SSR.
//
// force-dynamic is essential here, not optional — Next.js wraps
// fetch() (what supabase-js uses internally) with its own indefinite
// caching by default unless a route explicitly opts out. Without this,
// the first-ever request for a given business/invoice can get cached
// and keep being served forever afterward, completely invisible to
// direct database checks, rebuilds, or anything short of this exact
// declaration — this was the real cause of the missing
// paystack_subaccount_code/bank_account_number values.
export const dynamic = 'force-dynamic';

// A second, separate setting from the one above — dynamic controls
// whether Next.js treats this ROUTE itself as static or dynamic;
// fetchCache controls whether INDIVIDUAL fetch() calls made from
// WITHIN this route get cached, independently of that. supabase-js
// makes its own internal fetch() calls to Supabase's servers, and
// those calls are still subject to Next.js's default fetch-caching
// behavior unless this is also set explicitly — dynamic alone doesn't
// guarantee it. This was confirmed to be the actual, final missing
// piece: a direct curl request to Supabase's REST API (bypassing
// Next.js's fetch-patching entirely) was correct on every single test,
// while this route, going through the exact same query via
// supabase-js, could still occasionally return stale data even after
// force-dynamic and explicit no-store response headers were both
// already in place.
export const fetchCache = 'force-no-store';

const INVOICE_SELECT = 'id, invoice_number, customer_id, customer_name, customer_phone, subtotal, discount, loyalty_discount_applied, loyalty_discount_amount, service_charge_rate, service_charge_amount, vat_rate, vat_amount, shipping_fee, withholding_tax_rate, withholding_tax_amount, total, paid, payment_method, verification_code, estimated_delivery_date, due_date, custom_field_values, customer_signature_data, created_at, business_id, student_id, invoice_items(id, description, qty, price, sort_order), invoice_payments(method, amount), customers(email)';

// A short, deliberately narrow safety net for a real, confirmed
// inconsistency at the Supabase/database layer itself — not something
// this app's own code caused (every application-level cause was
// individually ruled out with direct evidence: no trigger touches
// UPDATE on this table, no queued-edit mechanism ever targets invoices,
// and browser/Next.js caching were both confirmed absent in the exact
// case that still failed). What was actually observed: a read
// happening shortly after its own write occasionally returned a
// snapshot from just before that write — reproducible via a direct
// server-to-server request that bypasses every cache this app
// controls. A manual re-check moments later always showed the correct,
// settled data.
//
// Retries up to 3 times total, with increasing delays (500ms, 1s, 2s —
// up to 3.5s of added latency in the worst case) rather than a single
// fixed wait — a single short retry wasn't reliably enough in practice,
// meaning the underlying lag can apparently last longer than a single
// guessed delay accounts for. Only ever applies when the invoice looks
// unpaid with no recorded payments AND was created within the last 5
// minutes — the only situation where "this might be a lagged read of a
// recent write" is plausible at all. A genuinely, simply unpaid
// invoice (the overwhelming majority of "unpaid, no payments" reads at
// any given moment) never enters this path and responds exactly as
// fast as before.
const RETRY_DELAYS_MS = [500, 1000, 2000];
const RECENT_WINDOW_MS = 5 * 60_000;

async function fetchInvoice(supabase, id) {
  return supabase.from('invoices').select(INVOICE_SELECT).eq('id', id)
    .order('sort_order', { foreignTable: 'invoice_items' }).single();
}

function looksPossiblyLagged(invoice) {
  const ageMs = Date.now() - new Date(invoice.created_at).getTime();
  return !invoice.paid && (invoice.invoice_payments || []).length === 0 && ageMs < RECENT_WINDOW_MS;
}

export async function GET(request, { params }) {
  const supabase = createAdminClient();

  let { data: invoice } = await fetchInvoice(supabase, params.id);

  if (!invoice) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  for (const delayMs of RETRY_DELAYS_MS) {
    if (!looksPossiblyLagged(invoice)) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const { data: rechecked } = await fetchInvoice(supabase, params.id);
    if (rechecked) invoice = rechecked;
  }

  const { data: business } = await supabase
    .from('businesses')
    .select('name, phone, address, logo_url, signature_url, bank_name, bank_account_name, bank_account_number, terms_and_conditions, paystack_subaccount_code')
    .eq('id', invoice.business_id)
    .single();

  const signature = computeReceiptSignature({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    businessId: invoice.business_id,
    total: invoice.total,
    createdAt: invoice.created_at,
  });

  // Explicit, belt-and-suspenders no-cache headers on the RESPONSE
  // itself — force-dynamic above stops Next.js's own server-side
  // caching of this route, but says nothing about the browser's own,
  // separate HTTP cache for a given fetch() call. Without this, a
  // caller like warmReceiptCache (which proactively fetches this exact
  // URL right after an invoice is created, for offline priming) could
  // have its response cached by the browser — and a genuinely fresh
  // page view moments later, fetching the identical URL, could then be
  // silently served that same stale, pre-payment snapshot straight from
  // the browser's cache, without ever touching the network again. This
  // header removes any ambiguity: no cache, anywhere, ever, for this
  // response.
  return NextResponse.json(
    { invoice, business, signature },
    { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
  );
}
