import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';

// Deliberately public — the number itself isn't sensitive (knowing "the
// limit is 5MB" poses no risk), and every image-upload point in the app
// needs this before it can validate a file, regardless of who's signed
// in or whether they're signed in at all yet.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  const admin = createAdminClient();
  const { data } = await admin.from('platform_settings').select('max_image_upload_mb').eq('id', true).maybeSingle();
  return NextResponse.json({ maxImageUploadMb: data?.max_image_upload_mb ?? 2 });
}
