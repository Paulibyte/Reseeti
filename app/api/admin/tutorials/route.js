import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { isPlatformAdmin } from '../../../../lib/isPlatformAdmin';
import { verifyCsrfToken } from '../../../../lib/csrf';

// See app/api/invoices/[id]/receipt-data/route.js's own comment on
// this exact pair — dynamic alone isn't sufficient for the
// createAdminClient() reads below to always be fresh.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const VALID_TYPES = ['doc', 'video'];

async function requireAdmin() {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  if (!(await isPlatformAdmin(user.id))) {
    return { error: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const admin = createAdminClient();
  const { data, error: dbError } = await admin
    .from('help_tutorials')
    .select('*')
    .order('category', { ascending: true })
    .order('created_at', { ascending: false });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ tutorials: data || [] });
}

export async function POST(req) {
  if (!verifyCsrfToken(req)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const type = body.type;
  const category = (body.category || '').trim();
  const title = (body.title || '').trim();
  const content = (body.content || '').trim();
  const youtubeUrl = (body.youtube_url || '').trim();

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'type must be doc or video' }, { status: 400 });
  }
  if (!category || !title) {
    return NextResponse.json({ error: 'Category and title are both required' }, { status: 400 });
  }
  if (type === 'doc' && !content) {
    return NextResponse.json({ error: 'A document needs some content' }, { status: 400 });
  }
  if (type === 'video' && !youtubeUrl) {
    return NextResponse.json({ error: 'A video needs a YouTube URL' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: dbError } = await admin.from('help_tutorials').insert({
    type,
    category,
    title,
    content: content || null,
    youtube_url: type === 'video' ? youtubeUrl : null,
    active: true,
  });

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
