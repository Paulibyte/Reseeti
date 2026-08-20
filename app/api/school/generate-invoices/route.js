import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { verifyCsrfToken } from '../../../../lib/csrf';

// Owner/manager only — same tier as other bulk/billing-affecting
// actions (subscription, catalogue payment setup). Uses the normal
// RLS-bound client throughout, not the service-role one: "Members
// create invoices" (Stage 41) already permits any active member to
// insert invoices for their own business, so there's no need to bypass
// RLS for this — just gate who can trigger the bulk action at the route
// level.
export async function POST(req) {
  if (!verifyCsrfToken(req)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const membership = await getMyBusinessId(supabase);
  if (!membership) return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  if (membership.role !== 'owner' && membership.role !== 'manager') {
    return NextResponse.json({ error: 'Only the owner or a manager can generate fee invoices.' }, { status: 403 });
  }

  const { termId } = await req.json().catch(() => ({}));
  if (!termId) return NextResponse.json({ error: 'Missing termId' }, { status: 400 });

  const { data: term } = await supabase
    .from('school_terms')
    .select('id, name, business_id')
    .eq('id', termId)
    .eq('business_id', membership.businessId)
    .maybeSingle();
  if (!term) return NextResponse.json({ error: 'Term not found' }, { status: 404 });

  const { data: feeRows } = await supabase
    .from('fee_structures')
    .select('class_id, description, amount, sort_order')
    .eq('term_id', termId)
    .order('sort_order');

  const feesByClass = {};
  for (const f of feeRows || []) {
    if (!feesByClass[f.class_id]) feesByClass[f.class_id] = [];
    feesByClass[f.class_id].push(f);
  }

  const { data: students } = await supabase
    .from('students')
    .select('id, name, class_id, parent_customer_id, customers(name, phone)')
    .eq('business_id', membership.businessId)
    .eq('status', 'active');

  let created = 0, skippedExisting = 0, skippedNoParent = 0, skippedNoFees = 0;

  for (const student of students || []) {
    const fees = feesByClass[student.class_id];
    if (!fees || fees.length === 0) { skippedNoFees++; continue; }
    if (!student.parent_customer_id) { skippedNoParent++; continue; }

    const subtotal = fees.reduce((sum, f) => sum + Number(f.amount), 0);

    const { data: invoice, error } = await supabase
      .from('invoices')
      .insert({
        business_id: membership.businessId,
        customer_id: student.parent_customer_id,
        customer_name: student.customers?.name || '',
        customer_phone: student.customers?.phone || null,
        subtotal,
        discount: 0,
        total: subtotal,
        student_id: student.id,
        term_id: termId,
        // Reuses the exact same idempotency mechanism the offline sync
        // queue relies on (Stage 32) — a unique index on
        // (business_id, client_ref). Running this twice for the same
        // student+term hits that constraint instead of creating a
        // duplicate invoice, which is what makes this safe to click
        // more than once without a separate "already generated" check.
        client_ref: `school-fee-${student.id}-${termId}`,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') { skippedExisting++; continue; }
      continue; // Any other single-student failure shouldn't abort the whole batch.
    }

    const itemRows = fees.map((f, i) => ({
      invoice_id: invoice.id,
      description: f.description,
      qty: 1,
      price: f.amount,
      sort_order: i,
    }));
    await supabase.from('invoice_items').insert(itemRows);
    created++;
  }

  return NextResponse.json({ created, skippedExisting, skippedNoParent, skippedNoFees, termName: term.name });
}
