import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '../../../../../lib/getPlatformAdmin';
import { createAdminClient } from '../../../../../lib/supabaseAdmin';

export async function DELETE(request, { params }) {
  const me = await requirePlatformAdmin();
  if (!me) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const supabase = createAdminClient();

  // Never allow removing the last remaining admin — that would lock
  // everyone (including whoever's doing this) out of the panel for good,
  // with no self-serve way back in (see schema_stage15.sql's bootstrap
  // note — recovering from that requires a direct SQL insert again).
  const { count } = await supabase
    .from('platform_admins')
    .select('user_id', { count: 'exact', head: true });

  if (count === 1) {
    return NextResponse.json({ error: 'Can\'t remove the last remaining admin' }, { status: 400 });
  }

  const { error } = await supabase
    .from('platform_admins')
    .delete()
    .eq('user_id', params.user_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
