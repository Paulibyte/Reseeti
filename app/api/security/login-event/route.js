import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabaseAdmin';
import { createRouteClient } from '../../../../lib/supabaseServer';
import { sendSms, toE164 } from '../../../../lib/twilioSms';
import { rateLimit, requestIp } from '../../../../lib/rateLimit';
import { verifyCsrfToken } from '../../../../lib/csrf';

export const dynamic = 'force-dynamic';

// Called by app/login/page.js right after a successful sign-in (phone
// OTP, plus a TOTP challenge too if the account has 2FA turned on) — by
// that point the Supabase session cookie is already set, so this route
// can identify the caller normally via createRouteClient(). Not
// meaningful to call any earlier, and nothing else in the app calls it.
export async function POST(request) {
  if (!verifyCsrfToken(request)) {
    return NextResponse.json({ error: 'Invalid request — please refresh the page and try again.' }, { status: 403 });
  }

  const supabase = createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // Keyed by IP rather than user_id — the interesting abuse case here is
  // many rapid calls hammering this endpoint (and the SMS it can send)
  // from one source, which a compromised-but-not-yet-detected account
  // could do just as easily as an outsider.
  const { allowed } = await rateLimit(`login-event:${requestIp(request)}`, { limit: 20, windowSeconds: 3600 });
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { deviceId, deviceLabel } = await request.json();
  if (!deviceId) {
    return NextResponse.json({ error: 'Missing deviceId' }, { status: 400 });
  }

  const admin = createAdminClient();
  const userAgent = request.headers.get('user-agent') || null;

  const { data: existingDevice } = await admin
    .from('user_devices')
    .select('id')
    .eq('user_id', user.id)
    .eq('device_id', deviceId)
    .maybeSingle();

  const isNewDevice = !existingDevice;

  await admin.from('user_devices').upsert({
    user_id: user.id,
    device_id: deviceId,
    label: deviceLabel || null,
    user_agent: userAgent,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'user_id,device_id' });

  // Find the business this login belongs to, purely to attach the audit
  // event to the right business_id and to look up this member's
  // login_alerts_enabled + phone for the alert below. A user with no
  // active membership yet (mid-invite, or account deleted) just skips
  // both — there's nothing to log against or alert on.
  const { data: membership } = await admin
    .from('business_members')
    .select('business_id, phone, login_alerts_enabled')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (membership) {
    await admin.from('events').insert({
      business_id: membership.business_id,
      user_id: user.id,
      event_type: 'login_success',
      metadata: { device_id: deviceId, device_label: deviceLabel || null, new_device: isNewDevice },
    });

    if (isNewDevice && membership.login_alerts_enabled && membership.phone) {
      try {
        await sendSms({
          to: toE164(membership.phone),
          body: `Reseeti: your account just signed in from a new device (${deviceLabel || 'unknown device'}). If this wasn't you, go to Security settings and sign out of all other devices.`,
        });
      } catch (err) {
        // A failed alert SMS shouldn't fail the login itself — the audit
        // event above already recorded the new-device login either way.
        console.error('Login alert SMS failed:', err.message);
      }
    }
  }

  return NextResponse.json({ ok: true, isNewDevice });
}
