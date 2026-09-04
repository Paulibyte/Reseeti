import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { isPlatformAdmin } from '../../../../lib/isPlatformAdmin';
import { verifyCsrfToken } from '../../../../lib/csrf';

// See receipt-data/route.js's comment on this exact pair of settings —
// not currently called by the admin UI (page.js reads announcements
// directly), but this GET exists for any future caller, and fixed here
// too so it doesn't become its own separate bug report later.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const VALID_TARGETS = ['all', 'free', 'pro'];

async function requireAdmin() {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  if (!(await isPlatformAdmin(user.id))) {
    return { error: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }
  return { user };
}

// Every announcement ever created, most recent first — the admin page
// needs the full history (including inactive ones) so a past promo can
// be reactivated or reviewed, not just whatever's currently live.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const admin = createAdminClient();
  const { data, error: dbError } = await admin
    .from('platform_announcements')
    .select('*')
    .order('created_at', { ascending: false });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ announcements: data || [] });
}

export async function POST(req) {
  if (!verifyCsrfToken(req)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const title = (body.title || '').trim();
  const message = (body.message || '').trim();
  const ctaLabel = (body.cta_label || '').trim();
  const ctaUrl = (body.cta_url || '').trim();
  const targetPlan = body.target_plan || 'all';

  if (!title || !message) {
    return NextResponse.json({ error: 'Title and message are both required' }, { status: 400 });
  }
  if (!VALID_TARGETS.includes(targetPlan)) {
    return NextResponse.json({ error: 'target_plan must be all, free, or pro' }, { status: 400 });
  }
  // A CTA button needs both a label and a real destination, or neither
  // at all — one without the other is a broken half-button, not a
  // simpler valid state.
  if ((ctaLabel && !ctaUrl) || (!ctaLabel && ctaUrl)) {
    return NextResponse.json({ error: 'A call-to-action needs both a label and a link, or leave both blank' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: dbError } = await admin.from('platform_announcements').insert({
    title,
    message,
    cta_label: ctaLabel || null,
    cta_url: ctaUrl || null,
    target_plan: targetPlan,
    active: true,
  });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
