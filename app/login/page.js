'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [stage, setStage] = useState('phone'); // 'phone' | 'otp' | 'mfa'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState(null);
  const [mfaChallengeId, setMfaChallengeId] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const router = useRouter();
  const supabase = createClient();
  const otpRefs = useRef([]);

  const fullPhone = toE164(phone);
  const otp = otpDigits.join('');

  async function sendOtp(e) {
    e?.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: fullPhone });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setStage('otp');
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: fullPhone,
      token: otp,
      type: 'sms',
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    await afterPrimaryFactor();
  }

  // Phone OTP is the primary factor (AAL1). If this account also has a
  // TOTP factor enrolled (Stage 25's Security page), Supabase requires a
  // second, separate verification before the session actually reaches
  // AAL2 — getAuthenticatorAssuranceLevel() is how the client finds out
  // a second step is needed at all, since the phone-OTP call above
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
    await finishLogin();
  }

  async function verifyMfa(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: mfaChallengeId,
      code: mfaCode,
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    await finishLogin();
  }

  // Records this device (Stage 25's Security page device list) and
  // triggers a login-alert SMS if it's genuinely new — best-effort, not
  // allowed to block or fail the actual sign-in if it errors.
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

            <form onSubmit={sendOtp} style={{ textAlign: 'left' }}>
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
                {loading ? 'Sending…' : 'Continue'}
              </button>
            </form>

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
              Verify Your Phone
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14.5, margin: '0 0 4px' }}>
              Enter the code sent to
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
                onClick={async () => { setResending(true); await sendOtp(); setResending(false); }}
                disabled={resending}
                style={resendLink}
              >
                {resending ? 'Resending…' : 'Resend'}
              </button>
            </p>
          </>
        ) : (
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
