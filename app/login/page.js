'use client';

import { useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../../lib/supabaseClient';
import Logo from '../components/Logo';
import { csrfFetch } from '../../lib/csrfFetch';
import { getDeviceId, guessDeviceLabel } from '../../lib/deviceId';

// Converts a Nigerian local number (08012345678) to E.164 format (+2348012345678)
// which is what Supabase / the SMS provider expects.
function toE164(input) {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('0')) return '+234' + digits.slice(1);
  if (digits.startsWith('234')) return '+' + digits;
  return '+234' + digits;
}

// Supabase (and the network layer under it) doesn't always hand back an
// error with a plain .message string — sometimes it's an empty object,
// sometimes message is blank, sometimes it's a raw fetch/network
// exception with a different shape entirely. Rendering the object
// itself (previously `setError(err.message)` with no fallback) could
// show a literal "{}" on screen with zero useful information, so every
// error path below runs through this instead.
function readableError(err) {
  if (!err) return 'Something went wrong. Please try again.';
  if (typeof err.message === 'string' && err.message.trim()) return err.message;
  return 'Something went wrong — please try again, or check your connection.';
}

// ---------------------------------------------------------------------
// Login model, in brief (see the Reseeti SMS-cost conversation this was
// built from): password is now the primary credential, checked locally
// with zero SMS cost. An OTP is only ever sent for three things —
// someone who hasn't set a password yet, an unrecognized device, or a
// password reset — mirroring how Moniepoint's app works, instead of
// sending an SMS on every single login the way this page used to.
//
// Existing accounts all still have full access with zero disruption:
// nobody has a password until they opt in, and the "Use SMS code
// instead" link below always falls straight back to exactly the old
// flow. See the set-password nudge in afterPrimaryFactor() for how
// someone opts in for the first time.
//
// Known limitation, stated plainly rather than buried: the "verify this
// new device" OTP step below is a client-side gate, not a database-
// enforced one. supabase.auth.signInWithPassword() issues a real,
// valid session the moment the password checks out — before this page
// ever asks for a device-verification code. Someone using the normal UI
// can't get past that screen without the code, but a password alone is
// still enough to obtain a working session token if used directly
// against the API rather than through this page. That's a real gap
// against the old all-SMS model's guarantee, traded deliberately for
// cutting SMS cost ~80-95% — closing it fully would mean enrolling
// every user in Supabase's phone-MFA system and requiring aal2 at the
// database/RLS layer, which is real additional work, not done here.
// ---------------------------------------------------------------------

// useSearchParams() (used below to capture ?ref= for the referral
// program — see schema_referrals.sql) requires a Suspense boundary in
// the App Router, or this page can't be statically prerendered
// correctly. The actual form logic is unchanged; it's just wrapped one
// level deeper now so the default export satisfies that requirement.
function LoginPage() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loginMode, setLoginMode] = useState('password'); // 'password' | 'otp' — which form shows on the 'phone' stage
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [stage, setStage] = useState('phone'); // 'phone' | 'otp' | 'mfa' | 'set-password'
  // Controls what happens after the 'otp' stage's code is verified —
  // set right before an OTP is actually sent, not before.
  const [flowContext, setFlowContext] = useState('primary-otp'); // 'primary-otp' | 'device-verify' | 'password-reset'
  const [passwordPromptReason, setPasswordPromptReason] = useState('nudge'); // 'nudge' | 'reset' — 'reset' hides the skip option
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState(null);
  const [mfaChallengeId, setMfaChallengeId] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const router = useRouter();
  // Captured once on mount — a referral link (reseeti.com/login?ref=<business_id>)
  // only ever matters for the very first OTP request of this visit, and
  // shouldn't change if the URL is otherwise manipulated mid-flow.
  const searchParams = useSearchParams();
  const referredBy = searchParams.get('ref');
  const supabase = createClient();
  const otpRefs = useRef([]);

  const fullPhone = toE164(phone);
  const otp = otpDigits.join('');

  async function signInWithPassword(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: err } = await supabase.auth.signInWithPassword({ phone: fullPhone, password });
    if (err) {
      setLoading(false);
      // Supabase returns the same generic message whether the password
      // was wrong or never set at all — can't distinguish, so the hint
      // covers both without confirming which one it was (that itself is
      // account-existence-safe, same reasoning as ordinary login forms).
      setError("That didn't work. If you haven't set a password yet, use \"Sign in with SMS code instead\" below.");
      return;
    }

    // Password checked out — a real session already exists at this
    // point (see the file-level note above). Now decide whether this
    // device needs the extra step.
    const res = await csrfFetch('/api/security/device-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId() }),
    });
    setLoading(false);

    if (!res.ok) {
      // Couldn't determine device status — fail toward the safer option
      // (ask for the code) rather than silently skipping it.
      await sendOtp(null, 'device-verify');
      return;
    }
    const { isNewDevice } = await res.json();
    if (isNewDevice) {
      await sendOtp(null, 'device-verify');
    } else {
      await afterPrimaryFactor();
    }
  }

  // context defaults to whatever flowContext already is; passed
  // explicitly by callers (like signInWithPassword above) that are
  // setting it fresh right before sending.
  async function sendOtp(e, context) {
    e?.preventDefault();
    const ctx = context || flowContext;
    setFlowContext(ctx);
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      phone: fullPhone,
      // Only ever read by the handle_new_user trigger for a genuinely
      // new signup (see schema_referrals.sql) — harmless and unused for
      // an existing user logging back in. referredBy is untrusted user
      // input (a URL query param), so it's passed through as plain
      // metadata rather than trusted/validated here; the trigger itself
      // safely discards anything that isn't a real business id.
      options: referredBy ? { data: { referred_by: referredBy } } : undefined,
    });
    setLoading(false);
    if (err) { setError(readableError(err)); return; }
    setStage('otp');
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.verifyOtp({
      phone: fullPhone,
      token: otp,
      type: 'sms',
    });
    setLoading(false);
    if (err) { setError(readableError(err)); return; }

    if (flowContext === 'password-reset') {
      setPasswordPromptReason('reset');
      setStage('set-password');
      return;
    }
    await afterPrimaryFactor();
  }

  // Phone OTP or password is the primary factor (AAL1). If this account
  // also has a TOTP factor enrolled (Security page), Supabase requires a
  // second, separate verification before the session actually reaches
  // AAL2 — getAuthenticatorAssuranceLevel() is how the client finds out
  // a second step is needed at all, since the primary-factor call above
  // succeeds either way (it only establishes the first factor).
  async function afterPrimaryFactor() {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
      const { data: factorData } = await supabase.auth.mfa.listFactors();
      const factor = factorData?.totp?.[0];
      if (factor) {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
        if (challengeError) { setError(challengeError.message); return; }
        setMfaFactorId(factor.id);
        setMfaChallengeId(challenge.id);
        setStage('mfa');
        return;
      }
    }
    await maybePromptForPassword();
  }

  async function verifyMfa(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: mfaChallengeId,
      code: mfaCode,
    });
    setLoading(false);
    if (err) { setError(readableError(err)); return; }
    await maybePromptForPassword();
  }

  // Only ever offered after a genuine OTP-primary login (someone who
  // doesn't have a password set yet) — password-mode and device-verify
  // logins skip straight to finishLogin(), since reaching either of
  // those already implies a password exists. Shown once: dismissing it
  // sets password_prompt_dismissed so it never nags again, independent
  // of ever actually setting one.
  async function maybePromptForPassword() {
    if (flowContext !== 'primary-otp') {
      await finishLogin();
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const meta = user?.user_metadata || {};
    if (meta.password_login_enabled || meta.password_prompt_dismissed) {
      await finishLogin();
      return;
    }
    setPasswordPromptReason('nudge');
    setStage('set-password');
  }

  async function savePassword(e) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (newPassword !== newPasswordConfirm) { setError("Passwords don't match."); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({
      password: newPassword,
      data: { password_login_enabled: true },
    });
    setLoading(false);
    if (err) { setError(readableError(err)); return; }
    await finishLogin();
  }

  async function skipPasswordPrompt() {
    setLoading(true);
    await supabase.auth.updateUser({ data: { password_prompt_dismissed: true } });
    setLoading(false);
    await finishLogin();
  }

  async function startPasswordReset() {
    if (!fullPhone || phone.length < 6) {
      setError('Enter your phone number first.');
      return;
    }
    await sendOtp(null, 'password-reset');
  }

  // Records this device (Security page device list) and triggers a
  // login-alert SMS if it's genuinely new — best-effort, not allowed to
  // block or fail the actual sign-in if it errors. Still called after a
  // device-verify step-up (not just a fresh/never-seen device) since
  // that's how the device actually gets recorded as recognized for next
  // time — device-check itself only reads, it never writes.
  async function finishLogin() {
    try {
      await csrfFetch('/api/security/login-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: getDeviceId(), deviceLabel: guessDeviceLabel() }),
      });
    } catch {
      // Non-fatal — the person still gets into their dashboard either way.
    }
    router.push('/dashboard');
  }

  function handleOtpChange(index, value) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otpDigits];
    next[index] = digit;
    setOtpDigits(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  }

  function handleOtpKeyDown(index, e) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  const otpHeading = flowContext === 'device-verify'
    ? "We don't recognize this device"
    : flowContext === 'password-reset'
      ? 'Reset your password'
      : 'Verify Your Phone';
  const otpSubtext = flowContext === 'device-verify'
    ? 'For your security, enter the code sent to confirm it\'s really you.'
    : flowContext === 'password-reset'
      ? "Enter the code sent to confirm it's you, then you can set a new password."
      : 'Enter the code sent to';

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
      }}
    >
      <div style={{ maxWidth: 380, width: '100%', textAlign: 'center' }}>
        <Logo size={52} style={{ justifyContent: 'center', marginBottom: 24 }} />

        {stage === 'phone' ? (
          <>
            <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 24, margin: '0 0 8px' }}>
              Welcome Back
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14.5, lineHeight: 1.5, margin: '0 0 28px' }}>
              Sign in to continue managing your invoices.
            </p>

            {loginMode === 'password' ? (
              <form onSubmit={signInWithPassword} style={{ textAlign: 'left' }}>
                <div style={phoneInputWrap}>
                  <span style={phonePrefix}>+234</span>
                  <input
                    type="tel"
                    placeholder="8012345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    autoFocus
                    style={phoneInput}
                  />
                </div>
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{ ...phoneInput, border: '1px solid var(--border)', borderRadius: 10, padding: '13px 12px', marginBottom: 16, background: 'var(--surface)' }}
                />
                <button disabled={loading} style={btnStyle}>
                  {loading ? 'Signing in…' : 'Sign In'}
                </button>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
                  <button type="button" onClick={() => { setError(''); setLoginMode('otp'); }} style={resendLink}>
                    Sign in with SMS code instead
                  </button>
                  <button type="button" onClick={startPasswordReset} style={{ ...resendLink, color: 'var(--text-faint)' }}>
                    Forgot password?
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={(e) => sendOtp(e, 'primary-otp')} style={{ textAlign: 'left' }}>
                <div style={phoneInputWrap}>
                  <span style={phonePrefix}>+234</span>
                  <input
                    type="tel"
                    placeholder="8012345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    autoFocus
                    style={phoneInput}
                  />
                </div>
                <button disabled={loading} style={btnStyle}>
                  {loading ? 'Sending…' : 'Send SMS Code'}
                </button>
                <p style={{ textAlign: 'center', marginTop: 14 }}>
                  <button type="button" onClick={() => { setError(''); setLoginMode('password'); }} style={resendLink}>
                    Sign in with password instead
                  </button>
                </p>
              </form>
            )}

            {error && <p style={errorStyle}>{error}</p>}

            <p style={helpText}>
              <Link href="/help" style={{ color: 'inherit' }}>Need help?</Link>
            </p>
            <p style={{ ...helpText, fontSize: 11 }}>
              <Link href="/privacy" style={{ color: 'inherit' }}>Privacy Policy</Link>
              {' · '}
              <Link href="/terms" style={{ color: 'inherit' }}>Terms of Service</Link>
            </p>
          </>
        ) : stage === 'otp' ? (
          <>
            <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 24, margin: '0 0 8px' }}>
              {otpHeading}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14.5, margin: '0 0 4px' }}>
              {otpSubtext}
            </p>
            <p style={{ color: 'var(--text)', fontSize: 15, fontWeight: 700, margin: '0 0 24px' }}>
              {fullPhone}
            </p>

            <form onSubmit={verifyOtp}>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
                {otpDigits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => (otpRefs.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    autoFocus={i === 0}
                    style={otpBox}
                  />
                ))}
              </div>
              <button disabled={loading || otp.length < 6} style={btnStyle}>
                {loading ? 'Verifying…' : 'Verify'}
              </button>
            </form>

            {error && <p style={errorStyle}>{error}</p>}

            <p style={helpText}>
              Didn&apos;t receive a code?{' '}
              <button
                type="button"
                onClick={async () => { setResending(true); await sendOtp(null, flowContext); setResending(false); }}
                disabled={resending}
                style={resendLink}
              >
                {resending ? 'Resending…' : 'Resend'}
              </button>
            </p>
          </>
        ) : stage === 'mfa' ? (
          <>
            <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 24, margin: '0 0 8px' }}>
              Enter Your 2FA Code
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14.5, margin: '0 0 24px' }}>
              Open your authenticator app and enter the current 6-digit code.
            </p>

            <form onSubmit={verifyMfa} style={{ textAlign: 'left' }}>
              <input
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                inputMode="numeric"
                autoFocus
                style={{ ...phoneInput, border: '1px solid var(--border)', borderRadius: 10, padding: '13px 12px', marginBottom: 16, textAlign: 'center', fontSize: 20, letterSpacing: 4, fontFamily: 'monospace' }}
              />
              <button disabled={loading || mfaCode.length !== 6} style={btnStyle}>
                {loading ? 'Verifying…' : 'Verify'}
              </button>
            </form>

            {error && <p style={errorStyle}>{error}</p>}
          </>
        ) : (
          <>
            <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 24, margin: '0 0 8px' }}>
              {passwordPromptReason === 'reset' ? 'Set a new password' : 'Skip SMS codes next time'}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14.5, lineHeight: 1.5, margin: '0 0 24px' }}>
              {passwordPromptReason === 'reset'
                ? 'Choose a new password for your account.'
                : "Set a password so you don't need an SMS code every time you sign in on this device."}
            </p>

            <form onSubmit={savePassword} style={{ textAlign: 'left' }}>
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoFocus
                style={{ ...phoneInput, border: '1px solid var(--border)', borderRadius: 10, padding: '13px 12px', marginBottom: 12, background: 'var(--surface)' }}
              />
              <input
                type="password"
                placeholder="Confirm password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                required
                style={{ ...phoneInput, border: '1px solid var(--border)', borderRadius: 10, padding: '13px 12px', marginBottom: 16, background: 'var(--surface)' }}
              />
              <button disabled={loading} style={btnStyle}>
                {loading ? 'Saving…' : passwordPromptReason === 'reset' ? 'Save & continue' : 'Set password'}
              </button>
              {passwordPromptReason === 'nudge' && (
                <button type="button" onClick={skipPasswordPrompt} disabled={loading} style={{ ...resendLink, display: 'block', margin: '14px auto 0' }}>
                  Skip for now
                </button>
              )}
            </form>

            {error && <p style={errorStyle}>{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}

const phoneInputWrap = {
  display: 'flex',
  alignItems: 'center',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--surface)',
  marginBottom: 16,
  overflow: 'hidden',
};

const phonePrefix = {
  padding: '13px 12px',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: 15,
  borderRight: '1px solid var(--border)',
};

const phoneInput = {
  flex: 1,
  padding: '13px 12px',
  border: 'none',
  outline: 'none',
  fontSize: 15,
  background: 'transparent',
  color: 'var(--text)',
};

const otpBox = {
  width: 44,
  height: 52,
  textAlign: 'center',
  fontSize: 20,
  fontWeight: 700,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--surface)',
  color: 'var(--text)',
  outline: 'none',
};

const btnStyle = {
  width: '100%',
  padding: '13px',
  background: 'var(--orange)',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
};

const errorStyle = {
  color: 'var(--danger)',
  fontSize: 13,
  marginTop: 12,
};

const helpText = {
  color: 'var(--text-faint)',
  fontSize: 13,
  marginTop: 22,
};

const resendLink = {
  background: 'none',
  border: 'none',
  color: 'var(--orange)',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  padding: 0,
};

export default function LoginPageWrapper() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}
