import { NextResponse } from 'next/server';
import { createRouteClient, getMyBusinessId } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { verifyCsrfToken } from '../../../../lib/csrf';

function slugify(name) {
  return (name || 'shop')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'shop';
}

// Enabling requires the service-role client, not the plain RLS-bound
// one: catalogue_enabled being Pro-only is an app-layer rule, not
// something RLS can enforce (the owner's normal update policy on
// businesses has no idea what plan they're on) — so this route is the
// ONLY place that's allowed to flip it on, checked here explicitly.
// BusinessSettings.jsx deliberately never includes catalogue_enabled in
// its own plain client-side update() call for exactly this reason.
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
    return NextResponse.json({ error: 'Only the business owner can turn on the catalogue.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: business } = await admin
    .from('businesses')
    .select('id, name, plan, catalogue_slug')
    .eq('id', membership.businessId)
    .single();

  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 });
  if (business.plan !== 'pro') {
    return NextResponse.json({ error: 'The online catalogue is a Pro feature — upgrade to turn it on.' }, { status: 403 });
  }

  // Already has a slug (was on before, or got disabled and re-enabled) —
  // reuse it rather than generating a new one, so a link the business
  // already shared never silently breaks.
  if (business.catalogue_slug) {
    await admin.from('businesses').update({ catalogue_enabled: true }).eq('id', business.id);
    return NextResponse.json({ slug: business.catalogue_slug });
  }

  const base = slugify(business.name);
  let slug = base;
  let suffix = 2;
  // Try base, base-2, base-3... until an unused one is found. Bounded at
  // 50 attempts purely as a sanity backstop against something pathological
  // looping forever — collisions this deep are not a realistic scenario.
  for (let i = 0; i < 50; i++) {
    const { data: existing } = await admin
      .from('businesses')
      .select('id')
      .eq('catalogue_slug', slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${base}-${suffix}`;
    suffix++;
  }

  const { error } = await admin
    .from('businesses')
    .update({ catalogue_slug: slug, catalogue_enabled: true })
    .eq('id', business.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ slug });
}
