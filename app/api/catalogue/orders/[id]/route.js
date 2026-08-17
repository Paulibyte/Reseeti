import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../../lib/supabaseServer';
import { verifyCsrfToken } from '../../../../../lib/csrf';

const ALLOWED_STATUSES = ['converted', 'dismissed'];

export async function POST(req, { params }) {
  if (!verifyCsrfToken(req)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const membership = await getMyBusinessId(supabase);
  if (!membership) return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });

  const { status } = await req.json().catch(() => ({}));
  if (!ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  // Ordinary RLS-bound client, not the service-role one — "Members
  // update catalogue orders" (Stage 45) already scopes this correctly
  // to the caller's own business, no need to bypass it here.
  const { error } = await supabase
    .from('catalogue_orders')
    .update({ status })
    .eq('id', params.id)
    .eq('business_id', membership.businessId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
