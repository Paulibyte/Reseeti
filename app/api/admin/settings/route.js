import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '../../../../lib/getPlatformAdmin';
import { createAdminClient } from '../../../../lib/supabaseAdmin';

export async function POST(request) {
  const admin = await requirePlatformAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { free_plan_invoice_limit, max_image_upload_mb } = await request.json();
  if (!Number.isFinite(free_plan_invoice_limit) || free_plan_invoice_limit < 0) {
    return NextResponse.json({ error: 'Limit must be a non-negative number' }, { status: 400 });
  }
  // 1-50MB — a floor to prevent an accidental 0 (which would silently
  // block every upload in the app) and a ceiling that's still
  // comfortably above any real photo while keeping a hard bound on how
  // much a single request can grow to.
  if (!Number.isFinite(max_image_upload_mb) || max_image_upload_mb < 1 || max_image_upload_mb > 50) {
    return NextResponse.json({ error: 'Max image upload size must be between 1 and 50 MB' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('platform_settings')
    .update({ free_plan_invoice_limit, max_image_upload_mb, updated_at: new Date().toISOString() })
    .eq('id', true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
