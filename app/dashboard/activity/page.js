'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';

// Human-readable labels for the event_type values this app actually
// writes (see lib/analytics.js's track() calls and the various API
// routes that insert into `events` directly) — anything not in this map
// just falls back to a de-slugified version of the raw type, so a new
// event_type introduced later doesn't need this list updated to show up
// reasonably.
const EVENT_LABELS = {
  invoice_marked_paid: 'Invoice marked paid',
  reminder_sent: 'Reminder sent (WhatsApp link)',
  sms_reminder_sent: 'SMS reminder sent',
  sms_reminder_failed: 'SMS reminder failed',
  whatsapp_reminder_sent: 'WhatsApp reminder sent',
  whatsapp_reminder_failed: 'WhatsApp reminder failed',
  upgrade_completed: 'Upgraded to Pro',
  login_success: 'Signed in',
  login_failed: 'Failed sign-in attempt',
  mfa_enrolled: 'Two-factor authentication turned on',
  mfa_unenrolled: 'Two-factor authentication turned off',
  signed_out_everywhere: 'Signed out of all other devices',
  device_forgotten: 'Device removed from known devices',
};

function labelFor(type) {
  return EVENT_LABELS[type] || type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export default function ActivityPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('activity'); // 'activity' | 'security'
  const [events, setEvents] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (business) loadEvents(0); }, [tab]);

  async function load() {
    const { user, business: biz, role: myRole } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);
    setLoading(false);
    if (myRole === 'owner') await loadEvents(0);
  }

  async function loadEvents(nextPage) {
    setFetching(true);
    const res = await fetch(`/api/activity?tab=${tab}&page=${nextPage}`);
    const data = await res.json();
    setEvents(nextPage === 0 ? (data.events || []) : (prev) => [...prev, ...(data.events || [])]);
    setHasMore(!!data.hasMore);
    setPage(nextPage);
    setFetching(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!can(role, 'manageSettings')) {
    return (
      <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to view this page.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 6px' }}>
        Activity &amp; Audit Log
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
        <strong>Activity</strong> is what happened in the business — invoices, reminders, upgrades.
        <strong> Security</strong> is sign-ins and account security changes.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>Activity</TabButton>
        <TabButton active={tab === 'security'} onClick={() => setTab('security')}>Security</TabButton>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {events.length === 0 && !fetching && (
          <p style={{ padding: 16, margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>Nothing here yet.</p>
        )}
        {events.map((e, idx) => (
          <div
            key={e.id}
            style={{
              padding: '12px 16px', borderBottom: idx === events.length - 1 ? 'none' : '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            }}
          >
            <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{labelFor(e.event_type)}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
              {new Date(e.created_at).toLocaleString('en-NG')}
            </span>
          </div>
        ))}
      </div>

      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button
            onClick={() => loadEvents(page + 1)}
            disabled={fetching}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
          >
            {fetching ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </DashboardShell>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'var(--orange)' : 'none',
        color: active ? '#fff' : 'var(--text-muted)',
        border: active ? 'none' : '1px solid var(--border)',
        borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
