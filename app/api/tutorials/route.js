import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  const admin = createAdminClient();
  const { data } = await admin
    .from('help_tutorials')
    .select('id, type, category, title, content, youtube_url')
    .eq('active', true)
    .order('category', { ascending: true })
    .order('created_at', { ascending: false });

  return NextResponse.json({ tutorials: data || [] });
}
