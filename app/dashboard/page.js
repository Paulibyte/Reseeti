'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { createClient } from '../../lib/supabaseClient';
import { getMyBusiness } from '../../lib/getMyBusiness';
import DashboardShell from './DashboardShell';
import VirtualInvoiceList from './VirtualInvoiceList';
import AiInsights from './AiInsights';
import OnboardingChecklist from './OnboardingChecklist';
import OfflineDraftReceipt from './OfflineDraftReceipt';
import AnnouncementBanner from './AnnouncementBanner';
import ReferralCard from './ReferralCard';
import { useRealtimeSync } from '../../lib/useRealtimeSync';
import { getQueue, syncQueue, pendingCount, onBackgroundSyncMessage, getEditConflicts } from '../../lib/offlineQueue';
import { listParkedSales } from '../../lib/parkedSales';
import { cacheGetAll, cacheSetAll } from '../../lib/idbCache';
import { warmReceiptCache } from '../../lib/receiptCache';
import { track } from '../../lib/analytics';
import { formatNaira } from '../../lib/format';
import { can } from '../../lib/permissions';

// Code splitting: these four are all modals/overlays that most page loads
// never open (a business owner who isn't at their invoice limit never
// sees UpgradeModal; most visits don't open Settings). Loading them
// eagerly meant every dashboard visit downloaded and parsed all four
// component bundles up front. next/dynamic defers each one to its own
// chunk, fetched only the moment its `show*` flag first flips true.
// ssr:false is safe (and desirable) here — they're all 'use client' forms
// that read from browser state anyway, so there's nothing for the server
// to usefully render, and skipping SSR for them avoids a hydration-time
// cost on a component nobody's looking at yet.
const InvoiceForm = dynamic(() => import('./InvoiceForm'), { ssr: false });
const BusinessSettings = dynamic(() => import('./BusinessSettings'), { ssr: false });
const UpgradeModal = dynamic(() => import('./UpgradeModal'), { ssr: false });
const MarkPaidModal = dynamic(() => import('./MarkPaidModal'), { ssr: false });
const SyncConflictModal = dynamic(() => import('./SyncConflictModal'), { ssr: false });
const ParkedSalesPanel = dynamic(() => import('./ParkedSalesPanel'), { ssr: false });
const PendingOrdersPanel = dynamic(() => import('./PendingOrdersPanel'), { ssr: false });

function greetingForHour(hour) {
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export default function Dashboard() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [resumeDraft, setResumeDraft] = useState(null);
  const [offlineReceiptEntry, setOfflineReceiptEntry] = useState(null);
  const [showParkedSales, setShowParkedSales] = useState(false);
  const [parkedCount, setParkedCount] = useState(0);
  const [showPendingOrders, setShowPendingOrders] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [markingPaidInvoice, setMarkingPaidInvoice] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [reminding, setReminding] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [queuedDrafts, setQueuedDrafts] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [outOfStockCount, setOutOfStockCount] = useState(0);
  const [depletedNotice, setDepletedNotice] = useState([]);
  const [planLimitBlockedCount, setPlanLimitBlockedCount] = useState(0);
  const [editConflicts, setEditConflicts] = useState([]);
  const [showConflicts, setShowConflicts] = useState(false);
  const [platformFreeLimit, setPlatformFreeLimit] = useState(5);
  // Bumped any time an action (mark paid, delete, new invoice saved)
  // should make the virtualized invoice list re-fetch from page 0. The
  // list manages its own paginated state internally, so this is a signal
  // rather than data — see VirtualInvoiceList's effect on this prop.
  const [invoiceRefreshToken, setInvoiceRefreshToken] = useState(0);

  useEffect(() => {
    load();
    setIsOnline(navigator.onLine);
    setQueuedDrafts(getQueue());
    setEditConflicts(getEditConflicts());
    refreshParkedCount();

    const handleOnline = () => { setIsOnline(true); attemptSync(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // The service worker's 'sync' handler (public/sw.js) can't reach
    // Supabase itself — it doesn't hold the signed-in session — so it
    // messages this tab to finish the job instead. See
    // lib/offlineQueue.js for the registration side of this handoff.
    const unsubscribeSync = onBackgroundSyncMessage(() => attemptSync());

    // Also try a sync on first load in case there's a leftover queue from
    // last time the tab was open while offline.
    if (navigator.onLine) attemptSync();

    // Two more automatic triggers, on top of the 'online' event and
    // Background Sync API above — both cover a gap those two don't:
    //
    // - visibilitychange: catches a trader who switches away from this
    //   tab (answers a call, checks WhatsApp) and comes back — the tab
    //   never actually went offline/online in that time, so neither
    //   'online' nor Background Sync would have fired, but a lot can
    //   have changed on another device in the meantime.
    // - a plain interval: catches the case where the tab is just left
    //   open and idle for a long stretch, so this device's view of
    //   things (and any queued edits sitting unsynced) doesn't go stale
    //   for the whole time someone's looking at it.
    const handleVisibility = () => { if (document.visibilityState === 'visible' && navigator.onLine) attemptSync(); };
    document.addEventListener('visibilitychange', handleVisibility);
    const intervalId = setInterval(() => { if (navigator.onLine) attemptSync(); }, 60_000);

    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      // The Paystack webhook usually lands within a second or two of the
      // redirect, but it's a separate request — so re-fetch after a short
      // delay rather than trusting the plan is updated the instant we land
      // back here.
      setTimeout(load, 2000);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribeSync();
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(intervalId);
    };
  }, []);

  // Live cross-device sync: a sale rung up on another device (a
  // different phone, a tablet at the till, a laptop in the back office)
  // shows up here within about a second — bumping invoiceRefreshToken
  // makes VirtualInvoiceList reload from page 0, and load() refreshes
  // the stat cards, since both depend on the same underlying invoices
  // this business now has. Doesn't distinguish which kind of change
  // (insert/update/delete) since all three affect the stats and list the
  // same way: "something changed, get the current picture again."
  useRealtimeSync(supabase, 'invoices', business?.id, () => {
    setInvoiceRefreshToken((t) => t + 1);
    load();
  });

  async function attemptSync() {
    const { business: biz } = await getMyBusiness(supabase);
    if (!biz) return;

    setSyncing(true);
    let planLimitBlocked = 0;
    await syncQueue(supabase, biz.id, ({ status }) => {
      if (status === 'blocked_plan_limit') planLimitBlocked++;
    });
    setPlanLimitBlockedCount(planLimitBlocked);
    setQueuedDrafts(getQueue());
    setEditConflicts(getEditConflicts());
    setSyncing(false);
    load();
  }

  async function refreshParkedCount() {
    const parked = await listParkedSales();
    setParkedCount(parked.length);
  }

  async function refreshPendingOrdersCount(businessId) {
    const id = businessId || business?.id;
    if (!id) return;
    const { count } = await supabase
      .from('catalogue_orders')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', id)
      .eq('status', 'pending');
    setPendingOrdersCount(count || 0);
  }

  function resumeSale(draft) {
    setResumeDraft(draft);
    setShowParkedSales(false);
    setShowPendingOrders(false);
    setShowForm(true);
  }

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides, fromCache } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }

    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});
    setOfflineMode(fromCache);
    refreshPendingOrdersCount(biz.id);

    // Paint from the last cached snapshot immediately (IndexedDB read is
    // async but fast — no network round trip), then let the network
    // fetch below overwrite it with the current numbers. On a slow
    // connection this is the difference between the stat cards showing
    // real (if slightly stale) numbers instantly vs. a blank "Loading…"
    // for a few seconds every time this page opens.
    const cached = await cacheGetAll('invoices', biz.id);
    if (cached.length) {
      setInvoices(cached);
      setLoading(false);
    }

    // If the business/membership check itself just had to fall back to
    // a cached snapshot (see lib/getMyBusiness.js), the same lack of
    // real connectivity almost certainly blocks every query below too —
    // skip straight to "this is a cold, offline open; cached invoices
    // are all there is right now" instead of letting each of the
    // following network calls hang for its own timeout, one after
    // another, before the page becomes usable.
    if (fromCache) {
      setLoading(false);
      return;
    }

    // Only the columns the stat cards / notifications on this page
    // actually read. This used to also join invoice_items(*) for every
    // invoice — nothing on this page renders line items, so that join
    // was pure dead weight, multiplying the payload by however many
    // items are on each invoice for no benefit. The invoice list itself
    // (below) fetches its own rows page-by-page through
    // VirtualInvoiceList rather than through this query at all.
    const { data: invs } = await supabase
      .from('invoices')
      .select('id, invoice_number, customer_name, total, paid, created_at')
      .eq('business_id', biz.id)
      .order('created_at', { ascending: false });
    setInvoices(invs || []);
    cacheSetAll('invoices', biz.id, invs || []);

    // Keeps the 50 most recently created invoices individually openable
    // offline too, not just visible by name in this list — see
    // lib/receiptCache.js's warmReceiptCache for the full reasoning.
    // Never awaited: this runs in the background and must never slow
    // down this page's own load, even on a slow connection or a
    // business with a large invoice history.
    warmReceiptCache((invs || []).slice(0, 50).map((i) => i.id)).catch(() => {});

    const { data: allProducts } = await supabase
      .from('products')
      .select('id, stock_qty, low_stock_threshold')
      .eq('business_id', biz.id);
    const outOfStock = (allProducts || []).filter((p) => Number(p.stock_qty) <= 0);
    const lowNotOut = (allProducts || []).filter((p) => Number(p.stock_qty) > 0 && Number(p.stock_qty) <= Number(p.low_stock_threshold));
    setOutOfStockCount(outOfStock.length);
    setLowStockCount(lowNotOut.length);

    // Platform-wide default for free-plan businesses — readable by any
    // signed-in user (see schema_stage15.sql). A business's own
    // monthly_invoice_limit (if set by an admin) overrides this.
    const { data: settings } = await supabase
      .from('platform_settings')
      .select('free_plan_invoice_limit')
      .single();
    setPlatformFreeLimit(settings?.free_plan_invoice_limit ?? 5);

    setLoading(false);
  }

  async function togglePaid(inv) {
    if (!inv.paid) {
      // Marking paid — collect a payment method first (see MarkPaidModal),
      // rather than flipping the flag immediately.
      setMarkingPaidInvoice(inv);
      return;
    }
    // Un-marking paid also asks for confirmation now — this used to be
    // a single, silent click with no warning at all, which is exactly
    // how an invoice that had genuinely just been marked paid could
    // look like it "reverted on its own": a stray click on the same
    // now-green PAID badge (while checking on something else entirely)
    // instantly undid it, with nothing on screen to suggest that's what
    // just happened. Marking paid already requires deliberately
    // confirming a whole modal — un-marking deserved the same basic
    // level of intentional confirmation, not less.
    if (!confirm(`Mark invoice ${inv.invoice_number} as unpaid again? This does not delete the payment record already saved for it.`)) return;
    const { error } = await supabase
      .from('invoices')
      .update({ paid: false, paid_at: null })
      .eq('id', inv.id);
    if (error) {
      alert(`Could not update this invoice: ${error.message}`);
      return;
    }
    load();
    setInvoiceRefreshToken((t) => t + 1);
  }

  async function deleteInvoiceRow(inv) {
    if (!confirm(`Delete invoice ${inv.invoice_number} for ${formatNaira(inv.total)}? This can't be undone.`)) return;
    const { error } = await supabase.from('invoices').delete().eq('id', inv.id);
    if (error) {
      alert(error.message.includes('policy') ? "You don't have permission to delete invoices." : error.message);
      return;
    }
    load();
    setInvoiceRefreshToken((t) => t + 1);
  }

  async function confirmMarkPaid(payments) {
    // payments is an array of { method, amount } — length 1 for a normal
    // single-method payment, or several for a split payment. The
    // invoices.payment_method column stays a quick-glance summary: the
    // one method name, or 'split' when more than one was used — the full
    // breakdown lives in invoice_payments either way.
    const summaryMethod = payments.length === 1 ? payments[0].method : 'split';

    // .select() is added here specifically so a failed match (wrong or
    // stale id, an RLS policy silently blocking the write) is
    // detectable — without it, .update() returns no error at all for a
    // WHERE clause that matches zero rows, and this function would
    // proceed exactly as if it had succeeded: closing the modal,
    // reloading the list, with nothing anywhere telling you the write
    // never actually happened.
    const { data: updated, error: updateError } = await supabase
      .from('invoices')
      .update({ paid: true, paid_at: new Date().toISOString(), payment_method: summaryMethod })
      .eq('id', markingPaidInvoice.id)
      .select('id');

    if (updateError) {
      alert(`Could not mark this invoice paid: ${updateError.message}`);
      return;
    }
    if (!updated || updated.length === 0) {
      alert('Could not mark this invoice paid — it may have been deleted, or you may not have permission. Try refreshing the list.');
      return;
    }

    const { error: paymentsError } = await supabase.from('invoice_payments').insert(
      payments.map((p) => ({ invoice_id: markingPaidInvoice.id, method: p.method, amount: p.amount }))
    );
    if (paymentsError) {
      // The invoice itself is genuinely marked paid at this point (the
      // update above already succeeded) — only the itemized payment
      // breakdown failed to save. Surfacing this clearly rather than
      // silently swallowing it, since the amounts/methods matter for
      // reporting even though the paid status itself is correct.
      alert(`Marked paid, but couldn't save the payment breakdown: ${paymentsError.message}`);
    }

    track('invoice_marked_paid', { payment_method: summaryMethod, split: payments.length > 1 });
    setMarkingPaidInvoice(null);
    load();
    setInvoiceRefreshToken((t) => t + 1);
  }

  async function sendReminder(inv) {
    setReminding(inv.id);
    const link = `${window.location.origin}/inv/${inv.id}`;
    const msg = `Hi ${inv.customer_name}, this is a friendly reminder that invoice ${inv.invoice_number} for ${formatNaira(inv.total)} from ${business.name} is still outstanding. You can view and pay here: ${link}`;
    const digits = (inv.customer_phone || '').replace(/\D/g, '');
    const waPhone = digits.startsWith('0') ? '234' + digits.slice(1) : digits;

    if (waPhone) {
      window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, '_blank');
    }

    await supabase.from('invoices').update({ last_reminded_at: new Date().toISOString() }).eq('id', inv.id);
    track('reminder_sent', { invoice_id: inv.id });
    setReminding(null);
    load();
    setInvoiceRefreshToken((t) => t + 1);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading || !business) {
    return (
      <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>
    );
  }

  const usedThisMonth = invoices.filter((i) => {
    const d = new Date(i.created_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const effectiveLimit = business.monthly_invoice_limit ?? platformFreeLimit;
  const atLimit = business.plan === 'free' && usedThisMonth >= effectiveLimit;

  const moneyOwed = invoices.filter((i) => !i.paid).reduce((sum, i) => sum + Number(i.total), 0);
  const moneyCollected = invoices.filter((i) => i.paid).reduce((sum, i) => sum + Number(i.total), 0);
  const uniqueCustomers = new Set(invoices.map((i) => i.customer_name)).size;

  const firstName = (business.name || '').split(' ')[0];
  const greeting = greetingForHour(new Date().getHours());

  const notifications = [];
  if (outOfStockCount > 0) notifications.push({ icon: '🚫', text: `${outOfStockCount} product${outOfStockCount === 1 ? '' : 's'} out of stock` });
  if (lowStockCount > 0) notifications.push({ icon: '⚠️', text: `${lowStockCount} product${lowStockCount === 1 ? '' : 's'} low on stock` });
  const recentlyPaid = invoices.find((i) => i.paid);
  if (recentlyPaid) notifications.push({ icon: '✅', text: `Invoice ${recentlyPaid.invoice_number} paid` });
  if (business.plan === 'pro') notifications.push({ icon: '🔄', text: 'Subscription renewed' });
  notifications.push({ icon: '👀', text: 'Customer viewed invoice' });

  return (
    <DashboardShell
      plan={business.plan}
      role={role}
      overrides={overrides}
      onUpgradeClick={can(role, 'manageSubscription', overrides) ? () => setShowUpgrade(true) : undefined}
      onSettingsClick={can(role, 'manageSettings', overrides) ? () => setShowSettings(true) : undefined}
      onCreateInvoice={can(role, 'createInvoice', overrides) ? () => (atLimit ? (can(role, 'manageSubscription', overrides) && setShowUpgrade(true)) : setShowForm(true)) : undefined}
      onSignOut={signOut}
      notifications={notifications}
    >
      {offlineMode && (
        <div style={{ background: 'var(--orange-bg)', color: 'var(--orange-dark)', textAlign: 'center', padding: '8px 12px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, marginBottom: 14 }}>
          You're offline — showing the last data saved on this device. Invoices you create now will sync once you're back online.
        </div>
      )}
      <AnnouncementBanner />
      {can(role, 'manageSubscription', overrides) && <ReferralCard />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        {business.logo_url && (
          <Image
            src={business.logo_url}
            alt=""
            width={36}
            height={36}
            loading="lazy"
            style={{ borderRadius: 8, objectFit: 'cover' }}
          />
        )}
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', margin: 0, fontSize: 22 }}>
          {greeting}, {firstName} 👋
        </h1>
      </div>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 22px', fontSize: 14.5 }}>Here&apos;s your business today.</p>

      {can(role, 'manageSettings', overrides) && (
        <OnboardingChecklist supabase={supabase} business={business} onOpenSettings={() => setShowSettings(true)} />
      )}

      {(!isOnline || queuedDrafts.length > 0) && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            background: isOnline ? 'var(--success-bg)' : 'var(--orange-bg)',
            border: `1px solid ${isOnline ? 'var(--success)' : 'var(--orange)'}`,
            borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12.5,
          }}
        >
          <span style={{ color: isOnline ? 'var(--success)' : 'var(--orange-dark)', fontWeight: 600 }}>
            {!isOnline
              ? `You're offline — invoices you save now will sync automatically once you're back online.`
              : syncing
              ? 'Syncing offline invoices…'
              : `${queuedDrafts.length} invoice${queuedDrafts.length === 1 ? '' : 's'} waiting to sync.`}
          </span>
          {isOnline && !syncing && queuedDrafts.length > 0 && (
            <button
              onClick={attemptSync}
              style={{ background: 'none', border: '1px solid var(--success)', color: 'var(--success)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
            >
              Sync now
            </button>
          )}
        </div>
      )}

      {editConflicts.length > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            background: 'var(--orange-bg)', border: '1px solid var(--orange)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12.5,
          }}
        >
          <span style={{ color: 'var(--orange-dark)', fontWeight: 600 }}>
            ⚠ {editConflicts.length} edit{editConflicts.length === 1 ? '' : 's'} made offline on this device conflict
            {editConflicts.length === 1 ? 's' : ''} with a change from another device.
          </span>
          <button
            onClick={() => setShowConflicts(true)}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            Review
          </button>
        </div>
      )}

      {planLimitBlockedCount > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            background: 'var(--danger-bg)', border: '1px solid var(--danger)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12.5,
          }}
        >
          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
            🚫 {planLimitBlockedCount} queued invoice{planLimitBlockedCount === 1 ? '' : 's'} couldn&apos;t sync — you&apos;ve
            reached this month&apos;s free plan limit. Upgrade to Pro to record {planLimitBlockedCount === 1 ? 'it' : 'them'}.
          </span>
          {can(role, 'manageSubscription', overrides) && (
            <button
              onClick={() => setShowUpgrade(true)}
              style={{ background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              Upgrade
            </button>
          )}
        </div>
      )}

      {depletedNotice.length > 0 && (
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            background: 'var(--danger-bg)', border: '1px solid var(--danger)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12.5,
          }}
        >
          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
            🚫 {depletedNotice.length === 1
              ? `${depletedNotice[0]} just sold out.`
              : `${depletedNotice.join(', ')} just sold out.`}
            {' '}Restock in Inventory when you can.
          </span>
          <button
            onClick={() => setDepletedNotice([])}
            style={{ background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {showSettings && (
        <BusinessSettings
          business={business}
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); load(); }}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22 }}>
        <StatCard label="Invoices" value={invoices.length} />
        <StatCard label="Customers" value={uniqueCustomers} />
        <StatCard label="Outstanding" value={formatNaira(moneyOwed)} accent="var(--danger)" />
        <StatCard label="Collected" value={formatNaira(moneyCollected)} accent="var(--success)" />
      </div>

      {can(role, 'viewAnalytics', overrides) && <AiInsights businessId={business.id} />}

      {business.plan === 'pro' && business.plan_grace_until && (
        <div style={{ background: 'var(--danger-bg, #fdecea)', border: '1px solid var(--danger)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <strong style={{ color: 'var(--danger)' }}>Your last subscription payment didn&apos;t go through.</strong>{' '}
          <span style={{ color: 'var(--text)' }}>
            Pro features still work for now, but your account reverts to Free on{' '}
            {new Date(business.plan_grace_until).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}{' '}
            unless payment is updated.
          </span>
          {can(role, 'manageSubscription', overrides) && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => setShowUpgrade(true)}
                style={{ background: 'var(--danger)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
              >
                Update payment
              </button>
            </div>
          )}
        </div>
      )}

      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {business.plan === 'pro'
          ? `Reseeti Pro — unlimited invoices${business.plan_renews_at ? ` · renews ${new Date(business.plan_renews_at).toLocaleDateString('en-NG')}` : ''}`
          : `${usedThisMonth}/${effectiveLimit} free invoices used this month`}
      </p>

      {atLimit ? (
        <div style={{ background: 'var(--orange-bg)', border: '1px solid var(--orange)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <strong style={{ color: 'var(--text)' }}>You&apos;ve hit this month&apos;s free limit.</strong>{' '}
          <span style={{ color: 'var(--text)' }}>
            {can(role, 'manageSubscription', overrides) ? 'Upgrade to Reseeti Pro to keep billing.' : 'Ask the business owner to upgrade to Reseeti Pro to keep billing.'}
          </span>
          {can(role, 'manageSubscription', overrides) && (
            <div style={{ marginTop: 10 }}>
              <button
                onClick={() => setShowUpgrade(true)}
                style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
              >
                Upgrade to Pro — from ₦4,167/mo
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div id="invoices" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', margin: 0, fontSize: 17 }}>Invoices</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {parkedCount > 0 && (
            <button
              onClick={() => setShowParkedSales(true)}
              style={{ background: 'var(--orange-bg)', color: 'var(--orange-dark)', border: '1px solid var(--orange)', padding: '9px 14px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
            >
              ⏸ Parked ({parkedCount})
            </button>
          )}
          {pendingOrdersCount > 0 && (
            <button
              onClick={() => setShowPendingOrders(true)}
              style={{ background: 'var(--orange-bg)', color: 'var(--orange-dark)', border: '1px solid var(--orange)', padding: '9px 14px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
            >
              🛒 Orders ({pendingOrdersCount})
            </button>
          )}
          {!atLimit && can(role, 'createInvoice', overrides) && (
            <button
              onClick={() => { setResumeDraft(null); setShowForm(true); }}
              style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 13.5 }}
            >
              + Create Invoice
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <InvoiceForm
          business={business}
          resumeDraft={resumeDraft}
          onClose={() => { setShowForm(false); setResumeDraft(null); }}
          onParked={() => { setShowForm(false); setResumeDraft(null); refreshParkedCount(); }}
          onSaved={(depleted, offlineEntry) => {
            setShowForm(false);
            setResumeDraft(null);
            setQueuedDrafts(getQueue());
            attemptSync();
            load();
            setInvoiceRefreshToken((t) => t + 1);
            if (depleted && depleted.length) setDepletedNotice(depleted);
            if (offlineEntry) setOfflineReceiptEntry(offlineEntry);
          }}
        />
      )}

      {offlineReceiptEntry && (
        <OfflineDraftReceipt
          entry={offlineReceiptEntry}
          business={business}
          onClose={() => setOfflineReceiptEntry(null)}
        />
      )}

      {showParkedSales && (
        <ParkedSalesPanel
          onClose={() => setShowParkedSales(false)}
          onResume={resumeSale}
          onChanged={refreshParkedCount}
        />
      )}

      {showPendingOrders && (
        <PendingOrdersPanel
          onClose={() => setShowPendingOrders(false)}
          onConvert={resumeSale}
          onChanged={() => refreshPendingOrdersCount()}
        />
      )}

      {/*
        Fetches and renders its own pages directly from Supabase (30 rows
        at a time via .range()), growing the list as the person scrolls
        (infinite scroll) while only ever mounting the rows within/near
        the visible viewport (virtualization) — so this stays fast whether
        the business has 12 invoices or 12,000. `invoiceRefreshToken`
        tells it to reset back to page 0 after an action changes the data.
      */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <VirtualInvoiceList
          supabase={supabase}
          businessId={business.id}
          role={role}
          overrides={overrides}
          refreshToken={invoiceRefreshToken}
          onTogglePaid={togglePaid}
          onDelete={deleteInvoiceRow}
          onRemind={sendReminder}
          reminding={reminding}
        />
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      {showConflicts && (
        <SyncConflictModal
          supabase={supabase}
          conflicts={editConflicts}
          onResolved={() => setEditConflicts(getEditConflicts())}
          onClose={() => setShowConflicts(false)}
        />
      )}
      {markingPaidInvoice && (
        <MarkPaidModal
          invoice={markingPaidInvoice}
          onConfirm={confirmMarkPaid}
          onClose={() => setMarkingPaidInvoice(null)}
        />
      )}
    </DashboardShell>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-faint)', margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 20, color: accent || 'var(--heading)', margin: 0 }}>{value}</p>
    </div>
  );
}