import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '../../../../lib/getPlatformAdmin';
import { createAdminClient } from '../../../../lib/supabaseAdmin';

export async function POST(request) {
  const me = await requirePlatformAdmin();
  if (!me) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { user_id, label } = await request.json();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!user_id || !uuidPattern.test(user_id)) {
    return NextResponse.json({ error: 'That doesn\'t look like a valid User UID' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Confirm the UUID actually belongs to a real, signed-up user before
  // granting it admin access — otherwise a typo'd UUID would silently
  // create an orphaned, unusable admin row.
  const { data: userLookup } = await supabase.auth.admin.getUserById(user_id);
  if (!userLookup?.user) {
    return NextResponse.json({ error: 'No signed-up user found with that UID' }, { status: 404 });
  }

  const { error } = await supabase
    .from('platform_admins')
    .insert({ user_id, label: label || null });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That person is already an admin' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
