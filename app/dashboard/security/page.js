'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { getDeviceId } from '../../../lib/deviceId';
import { csrfFetch } from '../../../lib/csrfFetch';

export default function SecurityPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  // 2FA
  const [factors, setFactors] = useState([]);
  const [enrolling, setEnrolling] = useState(null); // { factorId, qrCode, secret }
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);

  // Devices
  const [devices, setDevices] = useState([]);
  const [thisDeviceId, setThisDeviceId] = useState(null);

  // Login alerts
  const [loginAlertsEnabled, setLoginAlertsEnabled] = useState(true);

  // Sign out everywhere
  const [signingOut, setSigningOut] = useState(false);
  const [signOutNotice, setSignOutNotice] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);
    setThisDeviceId(getDeviceId());

    const { data: factorData } = await supabase.auth.mfa.listFactors();
    setFactors(factorData?.totp || []);

    const devicesRes = await fetch('/api/security/devices');
    const devicesData = await devicesRes.json();
    setDevices(devicesData.devices || []);

    // login_alerts_enabled lives on business_members, which the client
    // can SELECT its own row from directly (Stage 18's RLS allows
    // reading, just not writing — see app/api/security/login-alerts).
    const { data: memberRow } = await supabase
      .from('business_members')
      .select('login_alerts_enabled')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    setLoginAlertsEnabled(memberRow?.login_alerts_enabled ?? true);

    setLoading(false);
  }

  async function startEnroll() {
    setMfaError('');
    setMfaBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    setMfaBusy(false);
    if (error) { setMfaError(error.message); return; }
    setEnrolling({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnroll(e) {
    e.preventDefault();
    setMfaError('');
    setMfaBusy(true);
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrolling.factorId,
        challengeId: challenge.id,
        code: mfaCode,
      });
      if (verifyError) throw verifyError;

      setEnrolling(null);
      setMfaCode('');
      const { data: factorData } = await supabase.auth.mfa.listFactors();
      setFactors(factorData?.totp || []);
    } catch (err) {
      setMfaError(err.message);
    }
    setMfaBusy(false);
  }

  async function cancelEnroll() {
    if (enrolling) await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId });
    setEnrolling(null);
    setMfaCode('');
    setMfaError('');
  }

  async function disableTwoFactor(factorId) {
    if (!confirm('Turn off two-factor authentication for your account?')) return;
    setMfaBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setMfaBusy(false);
    if (error) { setMfaError(error.message); return; }
    setFactors((prev) => prev.filter((f) => f.id !== factorId));
  }

  async function forgetDevice(deviceId) {
    await csrfFetch(`/api/security/devices/${deviceId}`, { method: 'DELETE' });
    setDevices((prev) => prev.filter((d) => d.device_id !== deviceId));
  }

  async function toggleLoginAlerts(enabled) {
    setLoginAlertsEnabled(enabled);
    await csrfFetch('/api/security/login-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  }

  // 'others' signs out every session except this current one — the
  // meaningful "I think someone else has access to my account" button.
  // Supabase Auth doesn't expose which sessions existed or let this app
  // list/target one specifically (see schema_stage25.sql's comment on
  // user_devices) — this is the one real lever available, and it's
  // enough to actually solve the problem even without that granularity.
  async function signOutEverywhereElse() {
    if (!confirm("Sign out of every other device and browser? You'll stay signed in here.")) return;
    setSigningOut(true);
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setSigningOut(false);
    setSignOutNotice(error ? error.message : 'Done — every other session has been signed out.');
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 20px' }}>
        Security
      </h1>

      {/* ---------- Two-factor authentication ---------- */}
      <Section title="Two-factor authentication">
        {factors.length > 0 ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 10px' }}>
              ✅ Enabled — your account needs a code from your authenticator app to sign in.
            </p>
            <button onClick={() => disableTwoFactor(factors[0].id)} disabled={mfaBusy} style={dangerBtnStyle}>
              Turn off 2FA
            </button>
          </>
        ) : enrolling ? (
          <form onSubmit={confirmEnroll}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>
              Scan this QR code with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code it shows.
            </p>
            {enrolling.qrCode && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={enrolling.qrCode} alt="2FA QR code" style={{ width: 180, height: 180, marginBottom: 10 }} />
            )}
            <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '0 0 10px', wordBreak: 'break-all' }}>
              Can't scan it? Enter this key manually: <span style={{ fontFamily: 'monospace' }}>{enrolling.secret}</span>
            </p>
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              inputMode="numeric"
              style={{ ...inputStyle, maxWidth: 160, fontFamily: 'monospace', letterSpacing: 2 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="submit" disabled={mfaBusy || mfaCode.length !== 6} style={primaryBtnStyle}>
                {mfaBusy ? 'Verifying…' : 'Confirm'}
              </button>
              <button type="button" onClick={cancelEnroll} style={secondaryBtnStyle}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>
              Add a second step to sign-in using an authenticator app — on top of the SMS code you already enter every time.
            </p>
            <button onClick={startEnroll} disabled={mfaBusy} style={primaryBtnStyle}>
              {mfaBusy ? 'Starting…' : 'Set up 2FA'}
            </button>
          </>
        )}
        {mfaError && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>{mfaError}</p>}
      </Section>

      {/* ---------- Session management ---------- */}
      <Section title="Sessions">
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>
          If you think someone else might have access to your account, sign out everywhere except this device.
        </p>
        <button onClick={signOutEverywhereElse} disabled={signingOut} style={dangerBtnStyle}>
          {signingOut ? 'Signing out…' : 'Sign out of all other devices'}
        </button>
        {signOutNotice && <p style={{ fontSize: 12.5, color: 'var(--success)', marginTop: 8 }}>{signOutNotice}</p>}
      </Section>

      {/* ---------- Device management ---------- */}
      <Section title="Known devices">
        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 10px' }}>
          Devices that have signed in to your account. Removing one just forgets it from this list — it doesn't sign
          it out (use "Sign out of all other devices" above for that).
        </p>
        {devices.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>No devices recorded yet.</p>}
        {devices.map((d) => (
          <div key={d.device_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                {d.label || 'Unknown device'} {d.device_id === thisDeviceId && <span style={{ color: 'var(--success)', fontWeight: 700 }}>· this device</span>}
              </p>
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-faint)' }}>
                Last seen {new Date(d.last_seen_at).toLocaleString('en-NG')}
              </p>
            </div>
            <button onClick={() => forgetDevice(d.device_id)} style={secondaryBtnStyle}>Forget</button>
          </div>
        ))}
      </Section>

      {/* ---------- Login alerts ---------- */}
      <Section title="Login alerts">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={loginAlertsEnabled} onChange={(e) => toggleLoginAlerts(e.target.checked)} />
          Text me when my account signs in from a device I haven't used before
        </label>
      </Section>
    </DashboardShell>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px', marginBottom: 16 }}>
      <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 15, margin: '0 0 10px' }}>{title}</h3>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
  boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
};
const primaryBtnStyle = {
  background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 16px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const secondaryBtnStyle = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '9px 16px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const dangerBtnStyle = {
  background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '9px 16px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
