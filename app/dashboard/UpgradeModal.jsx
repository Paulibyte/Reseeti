'use client';

import { useEffect, useState } from 'react';
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
  const [tiers, setTiers] = useState([]);
  const [tier, setTier] = useState(null);
  const [loadingTiers, setLoadingTiers] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      // Admin-configurable now (see /admin) rather than hardcoded — the
      // "Signed-in users view active plan tiers" RLS policy (Stage 34)
      // is what lets this read straight from the browser client.
      const { data } = await supabase
        .from('plan_tiers')
        .select('id, label, amount_naira, months')
        .eq('active', true)
        .order('sort_order');
      setTiers(data || []);
      setTier(data?.[0]?.id || null);
      setLoadingTiers(false);
    })();
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!tier) return;
    track('upgrade_clicked', { gateway, tier });
    setLoading(true);
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/${gateway}/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ email, tier }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.error) { setError(data.error); return; }
    // Each gateway's route returns its checkout URL under a different key
    // (authorization_url for Paystack, cashier_url for OPay, checkout_url
    // for Monnify) since that's what each provider's own API calls it.
    window.location.href = data.authorization_url || data.cashier_url || data.checkout_url;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 380, width: '100%', borderTop: '5px solid var(--orange)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>Upgrade to Reseeti Pro</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
          Unlimited invoices · billed once for the period you choose.
        </p>
        <form onSubmit={submit}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Choose a plan
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {loadingTiers && <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>Loading plans…</p>}
            {!loadingTiers && tiers.length === 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>No plans are available right now — please try again later.</p>
            )}
            {tiers.map((t) => {
              const perMonth = t.amount_naira / t.months;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTier(t.id)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                    border: `1px solid ${tier === t.id ? 'var(--orange)' : 'var(--border)'}`,
                    background: tier === t.id ? 'var(--orange-bg)' : 'var(--bg)',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 13.5, color: tier === t.id ? 'var(--orange-dark)' : 'var(--text)' }}>
                    {t.label}
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, color: tier === t.id ? 'var(--orange-dark)' : 'var(--text)' }}>
                      ₦{Number(t.amount_naira).toLocaleString()}
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)' }}>
                      ₦{Math.round(perMonth).toLocaleString()}/mo
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

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
            <button type="submit" disabled={loading || !tier} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
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
