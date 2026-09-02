'use client';

import { useEffect, useState } from 'react';

export default function ReferralCard() {
  const [stats, setStats] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/referrals/stats')
      .then((res) => res.json())
      .then((data) => setStats(data))
      .catch(() => {});
  }, []);

  if (!stats?.businessId) return null;

  const link = `${window.location.origin}/login?ref=${stats.businessId}`;

  function copyLink() {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 16 }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 14.5, color: 'var(--heading)', fontFamily: 'var(--font-heading)' }}>
        Refer a friend, save 20%
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>
        Share your link. Once someone you refer subscribes to the annual plan, you get 20% off your next annual renewal.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5, background: 'var(--bg)', color: 'var(--text)' }}
        />
        <button
          onClick={copyLink}
          style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
        {stats.totalReferred} referred · {stats.qualified} qualified ·{' '}
        <strong style={{ color: stats.availableDiscounts > 0 ? 'var(--success)' : 'var(--text-faint)' }}>
          {stats.availableDiscounts} discount{stats.availableDiscounts === 1 ? '' : 's'} available
        </strong>
      </p>
    </div>
  );
}
