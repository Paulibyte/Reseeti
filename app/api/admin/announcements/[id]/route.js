import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../../lib/supabaseAdmin';
import { isPlatformAdmin } from '../../../../../lib/isPlatformAdmin';
import { verifyCsrfToken } from '../../../../../lib/csrf';

async function requireAdmin() {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  if (!(await isPlatformAdmin(user.id))) {
    return { error: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }
  return { user };
}

// Toggles active on/off — a full edit form for the text itself wasn't
// asked for; ending a promo or bringing an old one back is the actual
// day-to-day action here, matching the "manually toggled off" design
// decided in the schema migration's own comment.
export async function PATCH(req, { params }) {
  if (!verifyCsrfToken(req)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  if (typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'active must be true or false' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: dbError } = await admin
    .from('platform_announcements')
    .update({ active: body.active })
    .eq('id', params.id);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  if (!verifyCsrfToken(req)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }
  const { error } = await requireAdmin();
  if (error) return error;

  const admin = createAdminClient();
  const { error: dbError } = await admin.from('platform_announcements').delete().eq('id', params.id);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
