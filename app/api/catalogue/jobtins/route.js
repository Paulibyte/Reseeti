import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { verifyCsrfToken } from '../../../../lib/csrf';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Turns "List on Jobtins" on or off for the signed-in owner's business.
//
// Owner only: whether the business appears in a third-party marketplace
// is the owner's decision, not a manager's. Turning it ON needs a working
// public catalogue (Pro plan, catalogue switched on, a WhatsApp number) —
// otherwise the opt-in would silently do nothing. Turning it OFF is always
// allowed, whatever the plan, so an owner can never be stuck listed.
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
    return NextResponse.json({ error: 'Only the business owner can choose whether this shop is listed on Jobtins.' }, { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: business } = await admin
    .from('businesses')
    .select('id, name, plan, catalogue_enabled, catalogue_slug, whatsapp_number, jobtins_opt_in')
    .eq('id', membership.businessId)
    .single();
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });

  // Nothing to change — don't rewrite the "agreed on" date or log a duplicate.
  if (business.jobtins_opt_in === body.enabled) {
    return NextResponse.json({ enabled: body.enabled, unchanged: true });
  }

  if (body.enabled) {
    if (business.plan !== 'pro') {
      return NextResponse.json({ error: 'Listing on Jobtins needs the online catalogue, which is a Pro feature.' }, { status: 403 });
    }
    if (!business.catalogue_enabled || !business.catalogue_slug) {
      return NextResponse.json({ error: 'Turn on your online catalogue in Settings first, then list it on Jobtins.' }, { status: 400 });
    }
    if (!business.whatsapp_number) {
      return NextResponse.json({ error: 'Add your WhatsApp number in Settings first — shoppers from Jobtins order through it.' }, { status: 400 });
    }
  }

  const { error } = await admin
    .from('businesses')
    .update({ jobtins_opt_in: body.enabled, jobtins_opt_in_at: body.enabled ? new Date().toISOString() : null })
    .eq('id', business.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Shown on the owner's Activity page. Best effort: the choice itself has
  // already been saved, so a failure to log it must not undo or fail it.
  try {
    await admin.from('events').insert({
      business_id: business.id,
      user_id: user.id,
      event_type: body.enabled ? 'jobtins_opt_in' : 'jobtins_opt_out',
      metadata: { summary: body.enabled ? 'Listed this shop on Jobtins' : 'Removed this shop from Jobtins' },
    });
  } catch { /* ignore */ }

  return NextResponse.json({ enabled: body.enabled });
}
