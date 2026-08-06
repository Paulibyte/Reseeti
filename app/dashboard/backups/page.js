'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { csrfFetch } from '../../../lib/csrfFetch';

const PROVIDER_INFO = {
  google: { label: 'Google Drive', icon: '🟢' },
  dropbox: { label: 'Dropbox', icon: '🔵' },
  onedrive: { label: 'OneDrive', icon: '🔷' },
};

function BackupsPageContent() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState([]);
  const [runningProvider, setRunningProvider] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) setNotice({ type: 'success', text: `${PROVIDER_INFO[connected]?.label || connected} connected.` });
    if (error) setNotice({ type: 'error', text: error });
  }, [searchParams]);

  async function load() {
    const { user, business: biz, role: myRole } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);
    await loadConnections();
    setLoading(false);
  }

  async function loadConnections() {
    const res = await fetch('/api/backup/status');
    const data = await res.json();
    setConnections(data.connections || []);
  }

  async function runBackup(provider) {
    setRunningProvider(provider);
    setNotice(null);
    try {
      const res = await csrfFetch('/api/backup/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backup failed');
      setNotice({ type: 'success', text: `${PROVIDER_INFO[provider].label} backup complete.` });
    } catch (err) {
      setNotice({ type: 'error', text: err.message });
    }
    await loadConnections();
    setRunningProvider(null);
  }

  async function disconnect(provider) {
    if (!confirm(`Disconnect ${PROVIDER_INFO[provider].label}? You can reconnect any time, but this removes the stored access.`)) return;
    await csrfFetch('/api/backup/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    });
    await loadConnections();
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 6px' }}>
            Backups
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px', maxWidth: 520 }}>
            Connect a cloud account and every business owned by you can back up its customers, products, invoices,
            and expenses as a single JSON file — a safety copy separate from Reseeti itself.
          </p>
        </div>
        <a
          href="/api/export"
          style={{ background: 'var(--heading)', color: '#fff', borderRadius: 6, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          ⬇ Export data now
        </a>
      </div>

      {notice && (
        <p style={{
          fontSize: 13, padding: '10px 14px', borderRadius: 8, marginBottom: 16,
          background: notice.type === 'error' ? 'var(--danger-bg, #fdecea)' : 'var(--success-bg)',
          color: notice.type === 'error' ? 'var(--danger)' : 'var(--success)',
        }}>
          {notice.text}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Object.entries(PROVIDER_INFO).map(([provider, info]) => {
          const conn = connections.find((c) => c.provider === provider);
          return (
            <div key={provider} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{info.icon}</span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)', fontSize: 14.5 }}>{info.label}</p>
                    {conn ? (
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                        {conn.last_backup_at
                          ? `Last backup ${new Date(conn.last_backup_at).toLocaleString('en-NG')} — ${conn.last_backup_status === 'failed' ? `failed (${conn.last_backup_error})` : 'success'}`
                          : `Connected ${new Date(conn.connected_at).toLocaleDateString('en-NG')} — no backup run yet`}
                      </p>
                    ) : (
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>Not connected</p>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  {conn ? (
                    <>
                      <button
                        onClick={() => runBackup(provider)}
                        disabled={runningProvider === provider}
                        style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: runningProvider === provider ? 'default' : 'pointer' }}
                      >
                        {runningProvider === provider ? 'Backing up…' : 'Backup now'}
                      </button>
                      <button
                        onClick={() => disconnect(provider)}
                        style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <a
                      href={`/api/backup/${provider}/connect`}
                      style={{ background: 'var(--heading)', color: '#fff', borderRadius: 6, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}
                    >
                      Connect
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 18 }}>
        A daily automatic backup also runs for every connected provider — Connect once and it keeps running with no
        further action needed. "Backup now" is for the moment right before a big change you want a fresh safety copy
        of first. See README_STAGE24.md if Connect doesn't work yet — each provider needs its own API credentials
        configured on the server first.
      </p>
    </DashboardShell>
  );
}

export default function BackupsPage() {
  return (
    <Suspense fallback={<main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>}>
      <BackupsPageContent />
    </Suspense>
  );
}
