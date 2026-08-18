'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { formatNaira } from '../../../lib/format';

// Code splitting: UpgradeModal only renders for free-plan businesses at
// their invoice limit, and even then only after the person clicks
// Upgrade — most page loads never need it, so it's fetched as its own
// chunk on first use instead of bundled into every dashboard page.
const UpgradeModal = dynamic(() => import('../UpgradeModal'), { ssr: false });

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-NG', { month: 'short' });
}

// Last N calendar months (oldest first), each keyed 'YYYY-MM'.
function lastMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(monthKey(d));
  }
  return out;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Monday-start week, matching how most Nigerian traders think about
// "this week" (as opposed to a Sunday-start week).
function startOfWeek() {
  const d = startOfToday();
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', flex: '1 1 150px' }}>
      <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: accent || 'var(--text)' }}>{value}</p>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

function BarChart({ data, height = 140, formatValue = formatNaira }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height, padding: '0 4px' }}>
      {data.map((d) => (
        <div key={d.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-faint)', marginBottom: 4, whiteSpace: 'nowrap' }}>
            {d.value > 0 ? formatValue(d.value) : ''}
          </span>
          <div
            title={`${d.label}: ${formatValue(d.value)}`}
            style={{
              width: '100%',
              maxWidth: 34,
              height: Math.max(3, (d.value / max) * (height - 30)),
              background: d.highlight ? 'var(--orange)' : 'var(--orange-bg)',
              borderRadius: '4px 4px 0 0',
              border: d.highlight ? 'none' : '1px solid var(--border)',
            }}
          />
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6, fontWeight: d.highlight ? 700 : 500 }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// Day-of-week (Monday-start, matching startOfWeek's convention) × time-of-day
// grid — the classic "when do sales actually happen" view, cheaper to read
// at a glance than a 6-month bar chart for spotting a pattern like
// "Saturdays are busy" or "nothing happens before 8am."  Bucketed into
// six 4-hour windows rather than all 24 hours so it stays readable on a
// phone screen without horizontal scrolling doing any real work.
const HEATMAP_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HEATMAP_BUCKET_LABELS = ['12am', '4am', '8am', '12pm', '4pm', '8pm'];

function SalesHeatmap({ matrix }) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460 }}>
        <thead>
          <tr>
            <th style={{ width: 36 }} />
            {HEATMAP_BUCKET_LABELS.map((b) => (
              <th key={b} style={{ fontSize: 10.5, color: 'var(--text-faint)', fontWeight: 600, padding: '0 2px 4px' }}>{b}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HEATMAP_DAY_LABELS.map((day, r) => (
            <tr key={day}>
              <td style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, paddingRight: 8 }}>{day}</td>
              {HEATMAP_BUCKET_LABELS.map((bucketLabel, c) => {
                const count = matrix[r][c];
                const intensity = count / max;
                return (
                  <td key={c} style={{ padding: 3 }}>
                    <div
                      title={`${day} ${bucketLabel}–${HEATMAP_BUCKET_LABELS[(c + 1) % 6] || '12am'}: ${count} sale${count === 1 ? '' : 's'}`}
                      style={{
                        height: 26,
                        borderRadius: 4,
                        background: count === 0 ? 'var(--surface-alt)' : 'var(--orange)',
                        opacity: count === 0 ? 1 : 0.18 + intensity * 0.75,
                        border: '1px solid var(--border)',
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [catalogueViews, setCatalogueViews] = useState([]);
  const [catalogueOrders, setCatalogueOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  });

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const { data: invs } = await supabase
      .from('invoices')
      .select('id, customer_id, customer_name, total, paid, paid_at, created_at')
      .eq('business_id', biz.id);
    setInvoices(invs || []);

    const { data: exps } = await supabase
      .from('expenses')
      .select('id, category, amount, expense_date')
      .eq('business_id', biz.id);
    setExpenses(exps || []);

    // Catalogue analytics (Stage 47) — only meaningful for Pro
    // businesses (the catalogue itself is Pro-only), so skip the
    // queries entirely for a Free-plan business rather than running
    // them against tables that would just come back empty.
    if (biz.plan === 'pro') {
      const { data: views } = await supabase
        .from('catalogue_views')
        .select('created_at')
        .eq('business_id', biz.id);
      setCatalogueViews(views || []);

      const { data: cOrders } = await supabase
        .from('catalogue_orders')
        .select('items, total, payment_status, status, created_at')
        .eq('business_id', biz.id);
      setCatalogueOrders(cOrders || []);
    }

    // invoice_items don't carry business_id directly, so scope through
    // this business's own invoice ids (RLS also enforces this server-side).
    const ids = (invs || []).map((i) => i.id);
    if (ids.length) {
      const { data: its } = await supabase
        .from('invoice_items')
        .select('invoice_id, description, qty, price, product_id, cost_price_at_sale')
        .in('invoice_id', ids);
      setItems(its || []);

      // Powers the "how was today's money collected" breakdown — a
      // separate table from invoices.payment_method (which only stores
      // one summary string per invoice, 'split' for anything with more
      // than one method — see confirmMarkPaid in dashboard/page.js). This
      // is the actual per-method line items, including both halves of a
      // split cash+transfer payment.
      const { data: pays } = await supabase
        .from('invoice_payments')
        .select('invoice_id, method, amount, created_at')
        .in('invoice_id', ids);
      setPayments(pays || []);
    }

    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  const months = useMemo(() => lastMonths(6), []);
  const currentMonthKey = months[months.length - 1];
  const prevMonthKey = months[months.length - 2];

  const revenueByMonth = useMemo(() => {
    const map = {};
    months.forEach((m) => { map[m] = 0; });
    invoices.forEach((inv) => {
      if (!inv.paid) return;
      const when = inv.paid_at || inv.created_at;
      if (!when) return;
      const key = monthKey(new Date(when));
      if (key in map) map[key] += Number(inv.total || 0);
    });
    return map;
  }, [invoices, months]);

  const chartData = months.map((m) => ({
    key: m,
    label: monthLabel(m),
    value: revenueByMonth[m] || 0,
    highlight: m === currentMonthKey,
  }));

  const thisMonthRevenue = revenueByMonth[currentMonthKey] || 0;
  const lastMonthRevenue = revenueByMonth[prevMonthKey] || 0;
  const momChange = lastMonthRevenue > 0
    ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
    : (thisMonthRevenue > 0 ? 100 : 0);

  const paidInvoices = invoices.filter((i) => i.paid);
  const unpaidInvoices = invoices.filter((i) => !i.paid);
  const totalRevenue = paidInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const outstanding = unpaidInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const avgInvoice = invoices.length ? (totalRevenue + outstanding) / invoices.length : 0;
  const paidRate = invoices.length ? (paidInvoices.length / invoices.length) * 100 : 0;

  // "Sales" here means money actually collected (paid invoices), bucketed
  // by when they were paid — the numbers a trader checks first thing in
  // the morning and again before closing up. (This month's figure reuses
  // thisMonthRevenue above rather than recomputing it.)
  const { todaySales, weekSales } = useMemo(() => {
    const todayStart = startOfToday();
    const weekStart = startOfWeek();
    let today = 0, week = 0;
    paidInvoices.forEach((inv) => {
      const when = new Date(inv.paid_at || inv.created_at);
      const amt = Number(inv.total || 0);
      if (when >= todayStart) today += amt;
      if (when >= weekStart) week += amt;
    });
    return { todaySales: today, weekSales: week };
  }, [paidInvoices]);

  // Profit only counts items sold from inventory with a cost price on
  // record — items typed freehand, or products with no cost entered,
  // simply don't contribute (there's nothing to subtract). Scoped to paid
  // invoices only, same as totalRevenue, so "profit" means money actually
  // collected minus what it cost to provide, not money merely invoiced.
  const { totalProfit, itemsMissingCost } = useMemo(() => {
    const paidIds = new Set(paidInvoices.map((i) => i.id));
    let profit = 0;
    let missingCost = 0;
    items.forEach((it) => {
      if (!paidIds.has(it.invoice_id)) return;
      if (!it.product_id) return; // free-text item, no cost basis at all
      if (it.cost_price_at_sale === null || it.cost_price_at_sale === undefined) {
        missingCost++;
        return;
      }
      profit += (Number(it.price) - Number(it.cost_price_at_sale)) * Number(it.qty);
    });
    return { totalProfit: profit, itemsMissingCost: missingCost };
  }, [items, paidInvoices]);
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  // The literal "Profit = Sales − Expenses" formula — this is the number
  // that matters most to a shop owner checking "am I actually making
  // money," distinct from totalProfit above (which is gross margin on
  // goods sold only, before rent/salary/fuel/etc are accounted for).
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const netProfit = totalRevenue - totalExpenses;
  const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  const expensesByCategory = useMemo(() => {
    const labels = { fuel: '⛽ Fuel', transport: '🚗 Transport', salary: '💰 Salary', rent: '🏠 Shop rent', electricity: '⚡ Electricity', internet: '🌐 Internet', other: '📋 Other' };
    const map = {};
    expenses.forEach((e) => { map[e.category] = (map[e.category] || 0) + Number(e.amount || 0); });
    return Object.entries(map).map(([key, total]) => ({ name: labels[key] || key, total })).sort((a, b) => b.total - a.total);
  }, [expenses]);

  const topCustomers = useMemo(() => {
    const map = {};
    invoices.forEach((inv) => {
      const key = inv.customer_id || `legacy:${inv.customer_name}`;
      if (!map[key]) map[key] = { name: inv.customer_name || 'Unknown', total: 0, count: 0 };
      map[key].total += Number(inv.total || 0);
      map[key].count += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [invoices]);

  const topItems = useMemo(() => {
    const paidIds = new Set(paidInvoices.map((i) => i.id));
    const map = {};
    items.forEach((it) => {
      const key = it.description || 'Item';
      if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0, profit: 0, hasCost: false };
      map[key].qty += Number(it.qty || 0);
      map[key].revenue += Number(it.qty || 0) * Number(it.price || 0);
      if (paidIds.has(it.invoice_id) && it.product_id && it.cost_price_at_sale !== null && it.cost_price_at_sale !== undefined) {
        map[key].profit += (Number(it.price) - Number(it.cost_price_at_sale)) * Number(it.qty);
        map[key].hasCost = true;
      }
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [items, paidInvoices]);

  // "Best selling" means most units moved, which traders usually care about
  // separately from which item earns the most money — a ₦200 item selling
  // 500 times matters even if it's not the top revenue line.
  const bestSellingProduct = useMemo(() => {
    const map = {};
    items.forEach((it) => {
      const key = it.description || 'Item';
      if (!map[key]) map[key] = { name: key, qty: 0 };
      map[key].qty += Number(it.qty || 0);
    });
    const sorted = Object.values(map).sort((a, b) => b.qty - a.qty);
    return sorted[0] || null;
  }, [items]);

  const topCustomer = topCustomers[0] || null;

  // "Conversion rate" here means invoices issued vs. invoices actually
  // paid — there's no separate quote/estimate step in Reseeti, so the
  // meaningful conversion moment for a shop is "did the buyer pay," not
  // "did they accept a quote." Reuses paidRate rather than recomputing
  // the same ratio under a second name.
  const conversionRate = paidRate;

  // Repeat customer % needs the FULL customer map, not just the top 5
  // topCustomers keeps for display — a customer who bought once and
  // never came back is exactly as important to this count as one who's
  // #1 by revenue.
  const customerStats = useMemo(() => {
    const map = {};
    invoices.forEach((inv) => {
      const key = inv.customer_id || `legacy:${inv.customer_name}`;
      map[key] = (map[key] || 0) + 1;
    });
    const uniqueCustomers = Object.keys(map).length;
    const repeatCustomers = Object.values(map).filter((count) => count > 1).length;
    return {
      uniqueCustomers,
      repeatCustomers,
      repeatPercentage: uniqueCustomers ? (repeatCustomers / uniqueCustomers) * 100 : 0,
    };
  }, [invoices]);

  // Monthly trends beyond just revenue — invoice count and average
  // invoice value both tell a different story than revenue alone (e.g.
  // revenue flat but invoice count climbing means smaller average sales,
  // which revenue-only would hide).
  const invoiceCountChartData = useMemo(() => {
    const map = {};
    months.forEach((m) => { map[m] = 0; });
    invoices.forEach((inv) => {
      if (!inv.created_at) return;
      const key = monthKey(new Date(inv.created_at));
      if (key in map) map[key]++;
    });
    return months.map((m) => ({ key: m, label: monthLabel(m), value: map[m] || 0, highlight: m === currentMonthKey }));
  }, [invoices, months, currentMonthKey]);

  const avgValueChartData = useMemo(() => {
    const sums = {}, counts = {};
    months.forEach((m) => { sums[m] = 0; counts[m] = 0; });
    invoices.forEach((inv) => {
      if (!inv.created_at) return;
      const key = monthKey(new Date(inv.created_at));
      if (key in sums) { sums[key] += Number(inv.total || 0); counts[key]++; }
    });
    return months.map((m) => ({ key: m, label: monthLabel(m), value: counts[m] ? sums[m] / counts[m] : 0, highlight: m === currentMonthKey }));
  }, [invoices, months, currentMonthKey]);

  // Sales heatmap data — bucketed by when each invoice was *created*
  // (i.e. when the sale happened), not when it was paid, since payment
  // can lag the actual transaction by days. 7 rows (Mon-start) × 6
  // four-hour buckets.
  const heatmapMatrix = useMemo(() => {
    const matrix = Array.from({ length: 7 }, () => Array(6).fill(0));
    invoices.forEach((inv) => {
      if (!inv.created_at) return;
      const d = new Date(inv.created_at);
      const dayIdx = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
      const bucket = Math.floor(d.getHours() / 4); // 0..5
      matrix[dayIdx][bucket]++;
    });
    return matrix;
  }, [invoices]);

  const busiestDay = useMemo(() => {
    const totals = heatmapMatrix.map((row) => row.reduce((s, v) => s + v, 0));
    const max = Math.max(...totals);
    if (max === 0) return null;
    return { day: HEATMAP_DAY_LABELS[totals.indexOf(max)], count: max };
  }, [heatmapMatrix]);

  const PAYMENT_METHOD_LABELS = { cash: '💵 Cash', transfer: '🏦 Transfer', pos: '💳 POS', card: '💳 Card', ussd: '📱 USSD', other: '📋 Other' };

  // Everything below is scoped to selectedDate (a single calendar day,
  // local time — matches the <input type="date"> control), not the
  // month/all-time figures above. Two different "day" boundaries are
  // used on purpose: which invoices were *raised* that day (for the
  // items sold — a shop's daily sales report normally includes
  // everything sold that day, paid or on credit) vs. which payments were
  // *collected* that day (for the cash/POS/transfer split — a till
  // reconciliation cares about money that actually moved today, which
  // can include payment on an invoice raised a different day).
  const isSameLocalDay = (isoString, dateStr) => {
    if (!isoString) return false;
    const d = new Date(isoString);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10) === dateStr;
  };

  const dailyInvoiceIds = useMemo(() => {
    return new Set(invoices.filter((inv) => isSameLocalDay(inv.created_at, selectedDate)).map((inv) => inv.id));
  }, [invoices, selectedDate]);

  const dailyItemBreakdown = useMemo(() => {
    const map = {};
    items.forEach((it) => {
      if (!dailyInvoiceIds.has(it.invoice_id)) return;
      const key = it.description || 'Item';
      if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0 };
      map[key].qty += Number(it.qty || 0);
      map[key].revenue += Number(it.qty || 0) * Number(it.price || 0);
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  }, [items, dailyInvoiceIds]);

  const dailyTotalSold = dailyItemBreakdown.reduce((s, it) => s + it.revenue, 0);
  const dailyBestSeller = dailyItemBreakdown[0] || null;

  const dailyPaymentBreakdown = useMemo(() => {
    const map = {};
    let total = 0;
    payments.forEach((p) => {
      if (!isSameLocalDay(p.created_at, selectedDate)) return;
      const key = p.method || 'other';
      map[key] = (map[key] || 0) + Number(p.amount || 0);
      total += Number(p.amount || 0);
    });
    return {
      total,
      byMethod: Object.entries(map)
        .map(([method, amount]) => ({ method, label: PAYMENT_METHOD_LABELS[method] || method, amount }))
        .sort((a, b) => b.amount - a.amount),
    };
  }, [payments, selectedDate]);

  const catalogueStats = useMemo(() => {
    const now = new Date();
    const days = (n) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d;
    };
    const since30 = days(30);
    const since7 = days(7);

    const viewsIn = (from) => catalogueViews.filter((v) => new Date(v.created_at) >= from).length;
    const ordersIn = (from) => catalogueOrders.filter((o) => new Date(o.created_at) >= from);

    const orders30 = ordersIn(since30);
    const revenue30 = orders30.reduce((s, o) => s + Number(o.total || 0), 0);
    const paidOnline30 = orders30.filter((o) => o.payment_status === 'paid').length;
    const views30 = viewsIn(since30);

    // Top items, derived from every order's snapshotted line items
    // (Stage 45's `items` jsonb — no join needed, no join possible if a
    // product's since been deleted).
    const itemTotals = {};
    for (const o of orders30) {
      for (const it of o.items || []) {
        if (!itemTotals[it.name]) itemTotals[it.name] = { name: it.name, qty: 0, revenue: 0 };
        itemTotals[it.name].qty += Number(it.qty || 0);
        itemTotals[it.name].revenue += Number(it.qty || 0) * Number(it.price || 0);
      }
    }
    const topItems = Object.values(itemTotals).sort((a, b) => b.qty - a.qty).slice(0, 5);

    return {
      views7: viewsIn(since7),
      views30,
      orders30: orders30.length,
      revenue30,
      paidOnline30,
      whatsAppOnly30: orders30.length - paidOnline30,
      conversionRate: views30 > 0 ? (orders30.length / views30) * 100 : 0,
      topItems,
    };
  }, [catalogueViews, catalogueOrders]);

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!can(role, 'viewAnalytics', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to view this page.</p>
      </DashboardShell>
    );
  }

  const hasData = invoices.length > 0;

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides} onSignOut={signOut} onUpgradeClick={() => setShowUpgrade(true)}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 16px' }}>
        Analytics
      </h1>

      {!hasData ? (
        <div style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 12 }}>📊</div>
          <p style={{ fontWeight: 700, color: 'var(--text)', margin: '0 0 6px', fontSize: 15 }}>No data yet</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5, maxWidth: 340, margin: '0 auto' }}>
            Create and get paid on a few invoices, and revenue trends, top customers and invoice performance will show up here automatically.
          </p>
        </div>
      ) : (
        <>
          <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Sales</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <StatCard label="Today's sales" value={formatNaira(todaySales)} />
            <StatCard label="This week's sales" value={formatNaira(weekSales)} />
            <StatCard label="This month's sales" value={formatNaira(thisMonthRevenue)}
              accent={momChange >= 0 ? 'var(--success)' : 'var(--danger)'}
              sub={lastMonthRevenue > 0 ? `${momChange >= 0 ? '▲' : '▼'} ${Math.abs(momChange).toFixed(0)}% vs last month` : 'No prior month to compare'} />
            <StatCard label="Total revenue" value={formatNaira(totalRevenue)} sub="All time, paid invoices" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 8px' }}>
            <p style={{ margin: 0, fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Day breakdown</p>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5, background: 'var(--surface)', color: 'var(--text)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 18 }}>
            <div style={{ flex: '1 1 260px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <p style={{ margin: '0 0 2px', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>How it was paid</p>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-faint)' }}>{formatNaira(dailyPaymentBreakdown.total)} collected this day</p>
              {dailyPaymentBreakdown.byMethod.length === 0 && (
                <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No payments recorded for this day.</p>
              )}
              {dailyPaymentBreakdown.byMethod.map((m, idx) => (
                <div key={m.method} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: idx === dailyPaymentBreakdown.byMethod.length - 1 ? 'none' : '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13.5, color: 'var(--text)' }}>{m.label}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>
                    {formatNaira(m.amount)}
                    <span style={{ fontWeight: 500, color: 'var(--text-faint)', fontSize: 11.5 }}>
                      {' '}({dailyPaymentBreakdown.total > 0 ? ((m.amount / dailyPaymentBreakdown.total) * 100).toFixed(0) : 0}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div style={{ flex: '1 1 260px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <p style={{ margin: '0 0 2px', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>What sold</p>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-faint)' }}>
                {formatNaira(dailyTotalSold)} across {dailyItemBreakdown.reduce((s, it) => s + it.qty, 0)} unit{dailyItemBreakdown.reduce((s, it) => s + it.qty, 0) === 1 ? '' : 's'}
                {dailyBestSeller ? ` · best seller: ${dailyBestSeller.name}` : ''}
              </p>
              {dailyItemBreakdown.length === 0 && (
                <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No sales on this day.</p>
              )}
              {dailyItemBreakdown.map((it, idx) => (
                <div key={it.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: idx === dailyItemBreakdown.length - 1 ? 'none' : '1px solid var(--border)' }}>
                  <div>
                    <span style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: idx === 0 ? 700 : 500 }}>
                      {idx === 0 && '🏆 '}{it.name}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}> · {it.qty} sold</span>
                  </div>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(it.revenue)}</span>
                </div>
              ))}
            </div>
          </div>

          {business.plan === 'pro' && (
            <>
              <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Catalogue (last 30 days)
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
                <StatCard label="Shop visits" value={catalogueStats.views30} sub={`${catalogueStats.views7} in the last 7 days`} />
                <StatCard label="Orders placed" value={catalogueStats.orders30}
                  sub={`${catalogueStats.conversionRate.toFixed(1)}% of visits ordered`} />
                <StatCard label="Catalogue revenue" value={formatNaira(catalogueStats.revenue30)} />
                <StatCard label="Paid online vs WhatsApp" value={`${catalogueStats.paidOnline30} / ${catalogueStats.whatsAppOnly30}`}
                  sub="online-paid / WhatsApp-only orders" />
              </div>

              {catalogueStats.topItems.length > 0 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 18, maxWidth: 420 }}>
                  <p style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>Top catalogue items</p>
                  {catalogueStats.topItems.map((it, idx) => (
                    <div key={it.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: idx === catalogueStats.topItems.length - 1 ? 'none' : '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13.5, color: 'var(--text)' }}>
                        {idx === 0 && '🏆 '}{it.name} <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>· {it.qty} sold</span>
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(it.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Invoices</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <StatCard label="Paid invoices" value={paidInvoices.length} sub={formatNaira(totalRevenue)} accent="var(--success)" />
            <StatCard label="Unpaid invoices" value={unpaidInvoices.length} sub={formatNaira(outstanding)} accent={unpaidInvoices.length > 0 ? 'var(--danger)' : 'var(--success)'} />
            <StatCard label="Outstanding debt" value={formatNaira(outstanding)} accent={outstanding > 0 ? 'var(--danger)' : 'var(--success)'} sub={`${unpaidInvoices.length} customer${unpaidInvoices.length === 1 ? '' : 's'} owing`} />
            <StatCard label="Avg. invoice" value={formatNaira(avgInvoice)} sub={`${paidRate.toFixed(0)}% paid rate`} />
          </div>

          <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Profit &amp; expenses</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <StatCard label="Net profit" value={formatNaira(netProfit)} accent={netProfit >= 0 ? 'var(--success)' : 'var(--danger)'}
              sub={totalRevenue > 0 ? `${netMargin.toFixed(0)}% margin · Sales − Expenses` : 'No sales yet'} />
            <StatCard label="Total expenses" value={formatNaira(totalExpenses)} accent={totalExpenses > 0 ? 'var(--danger)' : 'var(--text)'} sub="All time" />
            <StatCard label="Gross profit" value={formatNaira(totalProfit)} accent={totalProfit >= 0 ? 'var(--success)' : 'var(--danger)'}
              sub={totalRevenue > 0 ? `${margin.toFixed(0)}% margin · before expenses${itemsMissingCost > 0 ? ', some items missing cost' : ''}` : 'Add cost prices in Inventory'} />
          </div>

          <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Highlights</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <StatCard label="Top customer" value={topCustomer ? topCustomer.name : '—'}
              sub={topCustomer ? `${formatNaira(topCustomer.total)} · ${topCustomer.count} invoice${topCustomer.count === 1 ? '' : 's'}` : 'No invoices yet'} />
            <StatCard label="Best selling product" value={bestSellingProduct ? bestSellingProduct.name : '—'}
              sub={bestSellingProduct ? `${bestSellingProduct.qty} sold` : 'No line items yet'} />
          </div>

          <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Conversion &amp; customers</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <StatCard label="Conversion rate" value={`${conversionRate.toFixed(0)}%`}
              accent={conversionRate >= 70 ? 'var(--success)' : conversionRate >= 40 ? undefined : 'var(--danger)'}
              sub="Invoices paid vs. issued" />
            <StatCard label="Avg. invoice value" value={formatNaira(avgInvoice)} sub={`Across ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`} />
            <StatCard label="Repeat customers" value={`${customerStats.repeatPercentage.toFixed(0)}%`}
              sub={`${customerStats.repeatCustomers} of ${customerStats.uniqueCustomers} customer${customerStats.uniqueCustomers === 1 ? '' : 's'} came back`} />
          </div>

          <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Monthly trends</p>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 18 }}>
            <div style={{ flex: '1 1 280px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 16px 6px' }}>
              <p style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>Revenue collected</p>
              <BarChart data={chartData} height={120} />
            </div>
            <div style={{ flex: '1 1 280px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 16px 6px' }}>
              <p style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>Invoices issued</p>
              <BarChart data={invoiceCountChartData} height={120} formatValue={(v) => String(Math.round(v))} />
            </div>
            <div style={{ flex: '1 1 280px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 16px 6px' }}>
              <p style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>Avg. invoice value</p>
              <BarChart data={avgValueChartData} height={120} />
            </div>
          </div>
          <p style={{ margin: '-12px 0 18px', fontSize: 11, color: 'var(--text-faint)' }}>Last 6 months.</p>

          <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>Sales heatmap</p>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 18 }}>
            <SalesHeatmap matrix={heatmapMatrix} />
            {busiestDay && (
              <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                Busiest slot: <strong style={{ color: 'var(--text)' }}>{busiestDay.day}</strong> ({busiestDay.count} sale{busiestDay.count === 1 ? '' : 's'} in that window, all time).
              </p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 280px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <p style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>Top customers</p>
              {topCustomers.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No invoices yet.</p>}
              {topCustomers.map((c, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: idx === topCustomers.length - 1 ? 'none' : '1px solid var(--border)' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{c.name}</p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{c.count} invoice{c.count === 1 ? '' : 's'}</p>
                  </div>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(c.total)}</p>
                </div>
              ))}
            </div>

            <div style={{ flex: '1 1 280px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <p style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>Top selling items</p>
              {topItems.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No line items yet.</p>}
              {topItems.map((it, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: idx === topItems.length - 1 ? 'none' : '1px solid var(--border)' }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{it.name}</p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>{it.qty} sold</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(it.revenue)}</p>
                    {it.hasCost && <p style={{ margin: 0, fontSize: 11.5, color: 'var(--success)' }}>{formatNaira(it.profit)} profit</p>}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ flex: '1 1 280px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <p style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>Expenses by category</p>
              {expensesByCategory.length === 0 && (
                <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>
                  No expenses logged yet. <a href="/dashboard/expenses" style={{ color: 'var(--heading)', fontWeight: 600 }}>Log one</a> to see it factored into Net profit.
                </p>
              )}
              {expensesByCategory.map((c, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: idx === expensesByCategory.length - 1 ? 'none' : '1px solid var(--border)' }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{c.name}</p>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(c.total)}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </DashboardShell>
  );
}
