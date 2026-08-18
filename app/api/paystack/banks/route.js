import { NextResponse } from 'next/server';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { listBanks } from '../../../../lib/paystack';

// Just needs the caller signed in (any active business member, not
// owner-specifically — picking a bank is part of filling in the same
// Settings form anyone with access to Business Settings can already
// see) — the actual write (enable-payments) is what's owner-gated.
export async function GET() {
  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const result = await listBanks();
    const banks = (result.data || []).map((b) => ({ name: b.name, code: b.code }));
    return NextResponse.json({ banks });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
