'use client';

import { useEffect, useState } from 'react';
import { csrfFetch } from '../../lib/csrfFetch';

// Rendered once, inside DashboardShell, so it shows on every dashboard
// page rather than needing every one of the 30+ pages to know about it.
// Checks on every mount rather than once per session — cheap (a single
// indexed lookup, see idx_business_members_phone_invited in
// schema_stage43.sql), and means a fresh invite sent while someone's
// mid-session shows up the next time they navigate, without needing a
// realtime subscription for something this infrequent.
export default function PendingInvitesBanner() {
  const [invites, setInvites] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/invites/pending');
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites || []);
      }
    })();
  }, []);

  async function accept(invite) {
    setBusyId(invite.id);
    setError('');
    const res = await csrfFetch('/api/invites/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: invite.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusyId(null);
      setError(data.error || 'Could not accept this invite.');
      return;
    }
    // Full reload rather than just updating local state — accepting
    // switches active_business_id too (see the accept route), and every
    // page's own role/business/permissions all come from a fresh
    // getMyBusiness() call on load, not from anything this component
    // could patch in place.
    window.location.href = '/dashboard';
  }

  async function decline(invite) {
    setBusyId(invite.id);
    setError('');
    const res = await csrfFetch('/api/invites/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipId: invite.id }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not decline this invite.');
      return;
    }
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
  }

  if (invites.length === 0) return null;

  return (
    <div style={{ background: 'var(--orange-bg)', borderBottom: '1px solid var(--orange)', padding: '10px 20px' }}>
      {invites.map((invite) => (
        <div key={invite.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '4px 0' }}>
          <span style={{ fontSize: 13.5, color: 'var(--orange-dark)', fontWeight: 600 }}>
            You&apos;ve been invited to join <strong>{invite.businessName}</strong> as {invite.role}.
          </span>
          <button
            onClick={() => accept(invite)}
            disabled={busyId === invite.id}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >
            Accept
          </button>
          <button
            onClick={() => decline(invite)}
            disabled={busyId === invite.id}
            style={{ background: 'none', border: '1px solid var(--orange)', color: 'var(--orange-dark)', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer' }}
          >
            Decline
          </button>
        </div>
      ))}
      {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, margin: '4px 0 0' }}>{error}</p>}
    </div>
  );
}
