'use client';

import { useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { track } from '../../lib/analytics';

const GATEWAYS = [
  { id: 'paystack', label: 'Paystack' },
  { id: 'opay', label: 'OPay' },
  { id: 'monnify', label: 'Monnify' },
];

export default function UpgradeModal({ onClose }) {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [gateway, setGateway] = useState('paystack');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    track('upgrade_clicked', { gateway });
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/${gateway}/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setError(data.error || `Could not start checkout (server said: ${res.status})`); return; }
      // Each gateway's route returns its checkout URL under a different key
      // (authorization_url for Paystack, cashier_url for OPay, checkout_url
      // for Monnify) since that's what each provider's own API calls it.
      window.location.href = data.authorization_url || data.cashier_url || data.checkout_url;
    } catch (err) {
      setError('Network error — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 380, width: '100%', borderTop: '5px solid var(--orange)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>Upgrade to Reseeti Pro</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          ₦1,500/month · unlimited invoices · billed automatically.
        </p>
        <form onSubmit={submit}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Pay with
          </label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {GATEWAYS.map((gw) => (
              <button
                key={gw.id}
                type="button"
                onClick={() => setGateway(gw.id)}
                style={{
                  flex: 1, padding: '8px 6px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${gateway === gw.id ? 'var(--orange)' : 'var(--border)'}`,
                  background: gateway === gw.id ? 'var(--orange-bg)' : 'var(--bg)',
                  color: gateway === gw.id ? 'var(--orange-dark)' : 'var(--text-muted)',
                }}
              >
                {gw.label}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            Email for billing receipts
          </label>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 12, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' }}
          />
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: -6 }}>
            An email is required even though you sign in with your phone — this is only used for payment receipts.
          </p>
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button type="submit" disabled={loading} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {loading ? 'Redirecting…' : 'Continue to payment'}
            </button>
            <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
