'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { cacheGetAll } from '../../../lib/idbCache';
import { getQueue, pendingCount } from '../../../lib/offlineQueue';
import { isInstallAvailable, isAlreadyInstalled, isIOSSafari } from '../../../lib/pwa';
import { APP_VERSION } from '../../../lib/version';

// This page exists because most of Stage 19/20's work (virtualized
// scrolling, IndexedDB caching, background sync, service worker
// lifecycle) is invisible from the UI on a normal day — it only shows
// itself as "the app felt fast" or "my offline invoice showed up later."
// That's fine for day-to-day use, but makes it hard to confirm any of it
// is actually working without digging through DevTools by hand every
// time. Everything below reads real, live browser state — nothing here
// is mocked or hardcoded.
export default function DiagnosticsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});
    if (biz) await runChecks(biz.id);
    setLoading(false);
  }

  async function runChecks(businessId) {
    setRefreshing(true);

    // --- Service worker ---
    let sw = { supported: 'serviceWorker' in navigator, registered: false };
    if (sw.supported) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        sw.registered = true;
        sw.scope = reg.scope;
        sw.activeState = reg.active?.state || null;
        sw.hasWaiting = !!reg.waiting;
        sw.hasInstalling = !!reg.installing;
        sw.backgroundSyncSupported = 'sync' in reg;
      }
    }

    // --- Cache Storage ---
    let caches_ = { supported: 'caches' in window, entries: [] };
    if (caches_.supported) {
      const names = await caches.keys();
      caches_.entries = await Promise.all(
        names.map(async (name) => {
          const cache = await caches.open(name);
          const keys = await cache.keys();
          return { name, count: keys.length };
        })
      );
    }

    // --- IndexedDB cache (lib/idbCache.js) ---
    let idb = { supported: typeof indexedDB !== 'undefined', stores: {} };
    if (idb.supported) {
      for (const store of ['invoices', 'customers', 'products']) {
        idb.stores[store] = (await cacheGetAll(store, businessId)).length;
      }
    }

    // --- Offline invoice queue (lib/offlineQueue.js) ---
    const queue = getQueue();
    const offlineQueue = {
      total: queue.length,
      pending: pendingCount(),
      failed: queue.filter((d) => d.status === 'failed').length,
    };

    // --- PWA install state (lib/pwa.js) ---
    const install = {
      installed: isAlreadyInstalled(),
      promptAvailable: isInstallAvailable(),
      platform: isIOSSafari() ? 'ios-manual' : 'standard',
    };

    // --- Manifest reachability ---
    let manifest = { reachable: false };
    try {
      const res = await fetch('/manifest.json');
      if (res.ok) {
        const data = await res.json();
        manifest = { reachable: true, name: data.name, icons: data.icons?.length || 0 };
      }
    } catch {
      manifest = { reachable: false };
    }

    // --- Database schema version (Stage 27) ---
    let schemaVersion = { reachable: false, latest: null };
    try {
      const { data, error } = await supabase
        .from('schema_migrations')
        .select('version, name')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      schemaVersion = { reachable: true, latest: data?.version ?? null, name: data?.name ?? null };
    } catch {
      // Most likely means schema_stage27.sql (which creates this table)
      // hasn't been run against this database yet.
      schemaVersion = { reachable: false, latest: null };
    }

    setReport({
      generatedAt: new Date().toISOString(),
      online: navigator.onLine,
      appVersion: APP_VERSION,
      serviceWorker: sw,
      cacheStorage: caches_,
      indexedDB: idb,
      offlineQueue,
      install,
      manifest,
      schemaVersion,
    });
    setRefreshing(false);
  }

  async function forceUpdateCheck() {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
    await runChecks(business.id);
  }

  async function clearCaches() {
    if (!confirm('Clear all Cache Storage entries? Cached images and pages will be re-downloaded next time they\'re needed.')) return;
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
    await runChecks(business.id);
  }

  async function copyReport() {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!can(role, 'manageSettings', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to view this page.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides} onSignOut={signOut}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>
          Diagnostics
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => runChecks(business.id)} disabled={refreshing} style={secondaryBtnStyle}>
            {refreshing ? 'Checking…' : 'Refresh'}
          </button>
          <button onClick={copyReport} style={secondaryBtnStyle}>
            {copied ? 'Copied!' : 'Copy report'}
          </button>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: '0 0 20px' }}>
        Live browser state — reload this page any time to re-check, or send "Copy report" to support if something's
        not working as expected. v{APP_VERSION}
      </p>

      {report && (
        <>
          <Section title="Connection">
            <Row label="Status" value={report.online ? 'Online' : 'Offline'} ok={report.online} />
          </Section>

          <Section title="Service worker (Stage 9 / 19 / 20)">
            <Row label="Supported by this browser" value={report.serviceWorker.supported ? 'Yes' : 'No'} ok={report.serviceWorker.supported} />
            <Row label="Registered" value={report.serviceWorker.registered ? 'Yes' : 'No'} ok={report.serviceWorker.registered} />
            {report.serviceWorker.registered && (
              <>
                <Row label="Active worker state" value={report.serviceWorker.activeState || '—'} ok={report.serviceWorker.activeState === 'activated'} />
                <Row
                  label="Update waiting"
                  value={report.serviceWorker.hasWaiting ? 'Yes — refresh banner should be showing' : 'No'}
                  ok={!report.serviceWorker.hasWaiting}
                  neutral={report.serviceWorker.hasWaiting}
                />
                <Row label="Background Sync API" value={report.serviceWorker.backgroundSyncSupported ? 'Supported' : 'Not supported by this browser'} ok={report.serviceWorker.backgroundSyncSupported} neutral={!report.serviceWorker.backgroundSyncSupported} />
              </>
            )}
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <button onClick={forceUpdateCheck} style={secondaryBtnStyle}>Check for update now</button>
            </div>
          </Section>

          <Section title="Cache Storage (Stage 19 / 20)">
            {report.cacheStorage.entries.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>No caches yet — visit a few pages first.</p>
            )}
            {report.cacheStorage.entries.map((c) => (
              <Row key={c.name} label={c.name} value={`${c.count} cached ${c.count === 1 ? 'entry' : 'entries'}`} ok={c.count > 0} neutral={c.count === 0} />
            ))}
            <div style={{ marginTop: 10 }}>
              <button onClick={clearCaches} style={dangerBtnStyle}>Clear all caches</button>
            </div>
          </Section>

          <Section title="IndexedDB read cache (Stage 19)">
            {Object.entries(report.indexedDB.stores).map(([store, count]) => (
              <Row key={store} label={store} value={`${count} cached row${count === 1 ? '' : 's'}`} ok={count > 0} neutral={count === 0} />
            ))}
          </Section>

          <Section title="Offline invoice queue (Stage 9 / 19)">
            <Row label="Pending drafts" value={String(report.offlineQueue.pending)} ok={report.offlineQueue.pending === 0} neutral={report.offlineQueue.pending > 0} />
            <Row label="Failed drafts" value={String(report.offlineQueue.failed)} ok={report.offlineQueue.failed === 0} />
          </Section>

          <Section title="Install (Stage 20)">
            <Row label="Already installed" value={report.install.installed ? 'Yes' : 'No'} ok neutral />
            <Row label="Install prompt available" value={report.install.promptAvailable ? 'Yes' : 'No — either already installed, already prompted, or unsupported'} ok neutral />
            <Row label="Platform path" value={report.install.platform === 'ios-manual' ? 'iOS manual instructions' : 'Standard beforeinstallprompt'} ok neutral />
          </Section>

          <Section title="Manifest">
            <Row label="manifest.json reachable" value={report.manifest.reachable ? `Yes — "${report.manifest.name}", ${report.manifest.icons} icon(s)` : 'No'} ok={report.manifest.reachable} />
          </Section>

          <Section title="Database schema version (Stage 27)">
            <Row
              label="Latest applied migration"
              value={report.schemaVersion.reachable ? `Stage ${report.schemaVersion.latest} (${report.schemaVersion.name})` : 'schema_migrations table not found'}
              ok={report.schemaVersion.reachable}
            />
            {report.schemaVersion.reachable && report.schemaVersion.latest < 27 && (
              <p style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 6 }}>
                This database is behind the app's code — run any schema_stageN.sql files after Stage {report.schemaVersion.latest}.
              </p>
            )}
          </Section>

          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
            Report generated {new Date(report.generatedAt).toLocaleString('en-NG')}
          </p>
        </>
      )}
    </DashboardShell>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
      <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 14.5, margin: '0 0 10px' }}>{title}</h3>
      {children}
    </div>
  );
}

// `ok` drives the dot color; `neutral` downgrades a "false" reading from
// red to gray for checks where "no" isn't actually a problem (e.g. no
// install prompt because the app is already installed).
function Row({ label, value, ok, neutral }) {
  const color = neutral ? 'var(--text-faint)' : ok ? 'var(--success)' : 'var(--danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text)', fontWeight: 600, textAlign: 'right' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
        {value}
      </span>
    </div>
  );
}

const secondaryBtnStyle = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 6, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
};

const dangerBtnStyle = {
  background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)',
  borderRadius: 6, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
};
