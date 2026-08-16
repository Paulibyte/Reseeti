import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { verifyCsrfToken } from '../../../../lib/csrf';

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
    return NextResponse.json({ error: 'Only the business owner can turn off the catalogue.' }, { status: 403 });
  }

  const admin = createAdminClient();
  // catalogue_slug is deliberately left in place — disabling just stops
  // the public page from serving (see app/shop/[slug]/page.js's
  // catalogue_enabled check), it doesn't free up or delete the slug, so
  // re-enabling later restores the exact same link.
  const { error } = await admin
    .from('businesses')
    .update({ catalogue_enabled: false })
    .eq('id', membership.businessId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
