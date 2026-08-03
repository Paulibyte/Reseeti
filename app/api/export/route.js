import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../lib/supabaseAdmin';
import { createRouteClient, getMyBusinessId } from '../../../lib/supabaseServer';
import { buildBackupPayload, backupFilename } from '../../../lib/backupExport';

export const dynamic = 'force-dynamic';

// GET /api/export — "Export Data" on the Backups page. Reuses the exact
// same payload Stage 24's cloud backups upload to a connected Google
// Drive/Dropbox/OneDrive — the only difference here is the response
// goes straight back to the browser as a downloadable file instead of
// being uploaded anywhere, for a business that just wants a copy right
// now without connecting a cloud account first.
export async function GET() {
  const supabase = createRouteClient();
  const membership = await getMyBusinessId(supabase);
  if (!membership) {
    return NextResponse.json({ error: 'No business found for this account' }, { status: 404 });
  }
  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'Only the business owner can export the full data set.' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: business } = await admin.from('businesses').select('*').eq('id', membership.businessId).single();
  const payload = await buildBackupPayload(admin, business);

  return new NextResponse(payload, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${backupFilename(business.name)}"`,
    },
  });
}
