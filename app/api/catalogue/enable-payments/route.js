import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { resolveAccountNumber, createSubaccount } from '../../../../lib/paystack';
import { verifyCsrfToken } from '../../../../lib/csrf';

// Owner-only, same as the subscription/billing actions — this is what
// determines where a customer's money actually goes, not something to
// leave open to every team member the way, say, editing a product is.
export async function POST(req) {
  if (!verifyCsrfToken(req)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const membership = await getMyBusinessId(supabase);
  if (!membership) return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only the business owner can set up online payments.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: business } = await admin
    .from('businesses')
    .select('id, name, bank_code, bank_account_number, bank_account_name, paystack_subaccount_code')
    .eq('id', membership.businessId)
    .single();

  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  if (!business.bank_code || !business.bank_account_number) {
    return NextResponse.json({ error: 'Add and save your bank details in Settings first.' }, { status: 400 });
  }

  // Paystack's own guidance, not optional: verify the account details
  // actually resolve to a real, matching account before creating
  // anything with them — they explicitly won't take responsibility for
  // a payout sent to the wrong account otherwise.
  let resolved;
  try {
    resolved = await resolveAccountNumber({ accountNumber: business.bank_account_number, bankCode: business.bank_code });
  } catch (err) {
    return NextResponse.json({ error: `Could not verify this bank account: ${err.message}` }, { status: 400 });
  }

  try {
    const subaccount = await createSubaccount({
      businessName: business.name,
      bankCode: business.bank_code,
      accountNumber: business.bank_account_number,
      percentageCharge: 0, // 100% of every catalogue sale settles to the business — see lib/paystack.js's comment
    });

    await admin
      .from('businesses')
      .update({ paystack_subaccount_code: subaccount.data.subaccount_code })
      .eq('id', business.id);

    return NextResponse.json({
      ok: true,
      resolvedAccountName: resolved.data?.account_name,
      subaccountCode: subaccount.data.subaccount_code,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
