'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { formatNaira } from '../../../lib/format';
import { exportCSV, exportExcel, exportPDF } from '../../../lib/exportTable';
import {
  REPORT_TYPES,
  SALES_REPORT_GROUPING,
  buildSalesReport,
  buildProductSalesReport,
  buildCustomerRankingReport,
  buildOutstandingDebtReport,
  buildInventoryReport,
  buildProfitReport,
  buildExpenseReport,
  buildTaxReport,
} from '../../../lib/reports';

// Code splitting: UpgradeModal only renders for free-plan businesses at
// their invoice limit, and even then only after the person clicks
// Upgrade — most page loads never need it, so it's fetched as its own
// chunk on first use instead of bundled into every dashboard page.
const UpgradeModal = dynamic(() => import('../UpgradeModal'), { ssr: false });

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthTitle(value) {
  const [y, m] = value.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
}

function csvEscape(val) {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toInputDate(d) {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function startOfWeekMon(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return x;
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d) { return endOfDay(new Date(d.getFullYear(), 11, 31)); }

// Plain date-range shortcuts, usable for any of the 11 reports — no
// longer tied to a "group by" the way a single merged Sales Report would
// have needed, since Daily/Weekly/Monthly/Yearly are now their own
// distinct report types (see DEFAULT_RANGE_FOR below for how each of
// those picks its own sensible starting range).
const PRESETS = [
  { id: 'today', label: 'Today', range: () => [startOfDay(new Date()), endOfDay(new Date())] },
  { id: 'week', label: 'This week', range: () => [startOfWeekMon(new Date()), endOfDay(new Date())] },
  { id: 'month', label: 'This month', range: () => [startOfMonth(new Date()), endOfDay(new Date())] },
  { id: 'year', label: 'This year', range: () => [startOfYear(new Date()), endOfDay(new Date())] },
];

// A sensible starting range for each report type when it's first
// selected — a "Daily Sales" report is much more useful defaulted to the
// last 30 days than to just today (one row), while "Yearly Sales" wants
// several years of history to actually show a trend. The date inputs
// stay fully editable afterward for a custom range.
function defaultRangeFor(reportId) {
  const now = new Date();
  switch (reportId) {
    case 'daily': {
      const from = startOfDay(new Date()); from.setDate(from.getDate() - 29);
      return [from, endOfDay(now)];
    }
    case 'weekly': {
      const from = startOfDay(new Date()); from.setDate(from.getDate() - 83); // ~12 weeks
      return [from, endOfDay(now)];
    }
    case 'monthly':
      return [startOfYear(now), endOfDay(now)];
    case 'yearly': {
      const from = new Date(now.getFullYear() - 4, 0, 1); // last 5 years
      return [from, endOfDay(now)];
    }
    default:
      return [startOfMonth(now), endOfDay(now)];
  }
}

export default function ReportsPage() {
  const supabase = createClient();
  const router = useRouter();
  const statementRef = useRef(null);
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [invoices, setInvoices] = useState([]);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [month, setMonth] = useState(currentMonthValue());
  const [downloading, setDownloading] = useState(false);

  const [reportType, setReportType] = useState('statement');
  const [preset, setPreset] = useState(null);
  const [fromDate, setFromDate] = useState(toInputDate(startOfMonth(new Date())));
  const [toDate, setToDate] = useState(toInputDate(new Date()));
  const [exporting, setExporting] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const { data: invs } = await supabase
      .from('invoices')
      .select('id, invoice_number, customer_id, customer_name, customer_phone, subtotal, discount, vat_rate, vat_amount, service_charge_amount, shipping_fee, withholding_tax_rate, withholding_tax_amount, total, paid, paid_at, payment_method, created_at')
      .eq('business_id', biz.id)
      .order('created_at', { ascending: false });
    setInvoices(invs || []);

    const { data: exps } = await supabase
      .from('expenses')
      .select('id, category, description, amount, expense_date')
      .eq('business_id', biz.id)
      .order('expense_date', { ascending: false });
    setExpenses(exps || []);

    const { data: prods } = await supabase
      .from('products')
      .select('id, name, price, cost_price, stock_qty')
      .eq('business_id', biz.id);
    setProducts(prods || []);

    // invoice_items don't carry business_id directly, so scope through
    // this business's own invoice ids (RLS also enforces this server-side).
    const ids = (invs || []).map((i) => i.id);
    if (ids.length) {
      const { data: its } = await supabase
        .from('invoice_items')
        .select('invoice_id, description, qty, price, product_id, cost_price_at_sale')
        .in('invoice_id', ids);
      setItems(its || []);
    }

    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  function applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    const [from, to] = p.range();
    setFromDate(toInputDate(from));
    setToDate(toInputDate(to));
  }

  function changeReportType(id) {
    setReportType(id);
    setPreset(null);
    if (id !== 'statement') {
      const [from, to] = defaultRangeFor(id);
      setFromDate(toInputDate(from));
      setToDate(toInputDate(to));
    }
  }

  const invoicesById = useMemo(() => {
    const map = {};
    invoices.forEach((i) => { map[i.id] = i; });
    return map;
  }, [invoices]);

  const range = useMemo(() => ({
    from: startOfDay(new Date(fromDate)),
    to: endOfDay(new Date(toDate)),
  }), [fromDate, toDate]);

  const report = useMemo(() => {
    if (reportType === 'statement') return null;
    if (reportType in SALES_REPORT_GROUPING) {
      return buildSalesReport(invoices, { ...range, groupBy: SALES_REPORT_GROUPING[reportType] });
    }
    switch (reportType) {
      case 'products': return buildProductSalesReport(items, invoicesById, range);
      case 'customers': return buildCustomerRankingReport(invoices, range);
      case 'debt': return buildOutstandingDebtReport(invoices);
      case 'inventory': return buildInventoryReport(products);
      case 'profit': return buildProfitReport(items, invoicesById, range);
      case 'expenses': return buildExpenseReport(expenses, range);
      case 'tax': return buildTaxReport(invoices, range);
      default: return null;
    }
  }, [reportType, invoices, items, invoicesById, products, expenses, range]);

  function filenameFor(r) {
    return `${business.name.replace(/\s+/g, '_')}-${r.title.replace(/\s+/g, '_')}-${fromDate}_to_${toDate}`;
  }

  async function handleExport(format) {
    if (!report) return;
    setExporting(true);
    try {
      if (format === 'csv') exportCSV(report, filenameFor(report));
      else if (format === 'excel') await exportExcel(report, filenameFor(report));
      else if (format === 'pdf') await exportPDF(report, filenameFor(report), business.name);
    } finally {
      setExporting(false);
    }
  }

  // ---------- Monthly Statement (unchanged from before this stage) ----------
  const monthInvoices = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return invoices.filter((inv) => {
      const d = new Date(inv.created_at);
      return d.getFullYear() === y && d.getMonth() === m - 1;
    });
  }, [invoices, month]);

  const monthExpenses = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return expenses.filter((e) => {
      const d = new Date(e.expense_date);
      return d.getFullYear() === y && d.getMonth() === m - 1;
    });
  }, [expenses, month]);

  const invoicedTotal = monthInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
  const collectedTotal = monthInvoices.filter((i) => i.paid).reduce((s, i) => s + Number(i.total || 0), 0);
  const outstandingTotal = invoicedTotal - collectedTotal;
  const discountTotal = monthInvoices.reduce((s, i) => s + Number(i.discount || 0), 0);
  const vatTotal = monthInvoices.reduce((s, i) => s + Number(i.vat_amount || 0), 0);
  const expensesTotal = monthExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const netProfitTotal = collectedTotal - expensesTotal;

  function downloadCSV() {
    const header = ['Invoice #', 'Date', 'Customer', 'Phone', 'Subtotal', 'Discount', 'Total', 'Status', 'Paid date'];
    const rows = monthInvoices.map((i) => [
      i.invoice_number,
      fmtDate(i.created_at),
      i.customer_name || '',
      i.customer_phone || '',
      i.subtotal,
      i.discount,
      i.total,
      i.paid ? 'Paid' : 'Unpaid',
      i.paid ? fmtDate(i.paid_at) : '',
    ]);
    rows.push([]);
    rows.push(['', '', '', '', '', 'Invoiced', invoicedTotal]);
    rows.push(['', '', '', '', '', 'Collected', collectedTotal]);
    rows.push(['', '', '', '', '', 'Outstanding', outstandingTotal]);
    if (vatTotal > 0) rows.push(['', '', '', '', '', 'VAT collected', vatTotal]);

    rows.push([]);
    rows.push(['EXPENSES']);
    rows.push(['Category', 'Date', 'Note', '', '', '', 'Amount']);
    monthExpenses.forEach((e) => {
      rows.push([e.category, fmtDate(e.expense_date), e.description || '', '', '', '', e.amount]);
    });
    rows.push([]);
    rows.push(['', '', '', '', '', 'Total expenses', expensesTotal]);
    rows.push([]);
    rows.push(['', '', '', '', '', 'NET PROFIT (Collected − Expenses)', netProfitTotal]);

    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${business.name.replace(/\s+/g, '_')}-statement-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadPDF() {
    setDownloading(true);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');
      const el = statementRef.current;
      const canvas = await html2canvas(el, {
        backgroundColor: '#FFFDF8',
        scale: 2,
        useCORS: true,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ unit: 'pt', format: [canvas.width / 2, canvas.height / 2] });
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);

      // pdf.save(filename) relies on the browser's `download` attribute
      // to trigger an automatic file save — desktop browsers handle this
      // fine, but mobile Safari largely ignores it, and it's unreliable
      // inside an installed PWA on Android too (which matters here,
      // since Reseeti actively encourages installing to the home
      // screen). Opening the PDF in a new tab instead works everywhere:
      // the browser's own PDF viewer takes over, and the person can use
      // its native Share/Download/Print options from there — the
      // standard, well-established workaround for this exact jsPDF
      // limitation on mobile.
      const blobUrl = pdf.output('bloburl');
      window.open(blobUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!can(role, 'viewReports', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to view this page.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides} onSignOut={signOut} onUpgradeClick={() => setShowUpgrade(true)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>
          Reports
        </h1>
        <select
          value={reportType}
          onChange={(e) => changeReportType(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13.5, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
        >
          <option value="statement">Monthly Statement</option>
          {REPORT_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>

      {reportType === 'statement' ? (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="month"
              value={month}
              max={currentMonthValue()}
              onChange={(e) => setMonth(e.target.value)}
              style={{ padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13.5, background: 'var(--surface)', color: 'var(--text)' }}
            />
            <button
              onClick={downloadCSV}
              disabled={monthInvoices.length === 0}
              style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: monthInvoices.length ? 'pointer' : 'not-allowed', opacity: monthInvoices.length ? 1 : 0.5 }}
            >
              ⬇ Download CSV
            </button>
            <button
              onClick={downloadPDF}
              disabled={monthInvoices.length === 0 || downloading}
              style={{ background: 'var(--orange)', border: 'none', color: '#fff', padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: monthInvoices.length ? 'pointer' : 'not-allowed', opacity: monthInvoices.length ? 1 : 0.5 }}
            >
              {downloading ? 'Preparing…' : '⬇ Download PDF statement'}
            </button>
          </div>

          <div ref={statementRef} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
            <p style={{ margin: '0 0 2px', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 17 }}>{business.name}</p>
            <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>Statement for {monthTitle(month)}</p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
              <div style={{ flex: '1 1 130px' }}>
                <p style={{ margin: '0 0 2px', fontSize: 11.5, color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>Invoiced</p>
                <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(invoicedTotal)}</p>
              </div>
              <div style={{ flex: '1 1 130px' }}>
                <p style={{ margin: '0 0 2px', fontSize: 11.5, color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>Collected</p>
                <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--success)' }}>{formatNaira(collectedTotal)}</p>
              </div>
              <div style={{ flex: '1 1 130px' }}>
                <p style={{ margin: '0 0 2px', fontSize: 11.5, color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>Outstanding</p>
                <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: outstandingTotal > 0 ? 'var(--danger)' : 'var(--success)' }}>{formatNaira(outstandingTotal)}</p>
              </div>
              <div style={{ flex: '1 1 130px' }}>
                <p style={{ margin: '0 0 2px', fontSize: 11.5, color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>Discounts given</p>
                <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(discountTotal)}</p>
              </div>
              {vatTotal > 0 && (
                <div style={{ flex: '1 1 130px' }}>
                  <p style={{ margin: '0 0 2px', fontSize: 11.5, color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>VAT collected</p>
                  <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(vatTotal)}</p>
                </div>
              )}
              <div style={{ flex: '1 1 130px' }}>
                <p style={{ margin: '0 0 2px', fontSize: 11.5, color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>Expenses</p>
                <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: expensesTotal > 0 ? 'var(--danger)' : 'var(--text)' }}>{formatNaira(expensesTotal)}</p>
              </div>
              <div style={{ flex: '1 1 130px' }}>
                <p style={{ margin: '0 0 2px', fontSize: 11.5, color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>Net profit</p>
                <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: netProfitTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatNaira(netProfitTotal)}</p>
              </div>
            </div>

            {monthInvoices.length === 0 ? (
              <p style={{ color: 'var(--text-faint)', fontSize: 13.5 }}>No invoices in {monthTitle(month)}.</p>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'flex', padding: '8px 12px', background: 'var(--surface-alt)', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  <span style={{ flex: '0 0 90px' }}>Invoice</span>
                  <span style={{ flex: '0 0 80px' }}>Date</span>
                  <span style={{ flex: 1 }}>Customer</span>
                  <span style={{ flex: '0 0 70px', textAlign: 'center' }}>Status</span>
                  <span style={{ flex: '0 0 90px', textAlign: 'right' }}>Total</span>
                </div>
                {monthInvoices.map((inv, idx) => (
                  <div
                    key={inv.id}
                    style={{
                      display: 'flex', padding: '10px 12px', fontSize: 13,
                      borderTop: idx === 0 ? 'none' : '1px solid var(--border)', color: 'var(--text)',
                    }}
                  >
                    <span style={{ flex: '0 0 90px', color: 'var(--text-muted)' }}>{inv.invoice_number}</span>
                    <span style={{ flex: '0 0 80px', color: 'var(--text-muted)' }}>{fmtDate(inv.created_at)}</span>
                    <span style={{ flex: 1 }}>{inv.customer_name || '—'}</span>
                    <span style={{ flex: '0 0 70px', textAlign: 'center', fontWeight: 700, color: inv.paid ? 'var(--success)' : 'var(--danger)', fontSize: 11.5 }}>
                      {inv.paid ? 'PAID' : 'UNPAID'}
                    </span>
                    <span style={{ flex: '0 0 90px', textAlign: 'right', fontWeight: 600 }}>{formatNaira(inv.total)}</span>
                  </div>
                ))}
              </div>
            )}

            {monthExpenses.length > 0 && (
              <>
                <p style={{ margin: '20px 0 8px', fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>Expenses</p>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', padding: '8px 12px', background: 'var(--surface-alt)', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    <span style={{ flex: '0 0 80px' }}>Date</span>
                    <span style={{ flex: '0 0 110px' }}>Category</span>
                    <span style={{ flex: 1 }}>Note</span>
                    <span style={{ flex: '0 0 90px', textAlign: 'right' }}>Amount</span>
                  </div>
                  {monthExpenses.map((e, idx) => (
                    <div
                      key={e.id}
                      style={{
                        display: 'flex', padding: '10px 12px', fontSize: 13,
                        borderTop: idx === 0 ? 'none' : '1px solid var(--border)', color: 'var(--text)',
                      }}
                    >
                      <span style={{ flex: '0 0 80px', color: 'var(--text-muted)' }}>{fmtDate(e.expense_date)}</span>
                      <span style={{ flex: '0 0 110px', textTransform: 'capitalize' }}>{e.category}</span>
                      <span style={{ flex: 1, color: 'var(--text-muted)' }}>{e.description || '—'}</span>
                      <span style={{ flex: '0 0 90px', textAlign: 'right', fontWeight: 600 }}>{formatNaira(e.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                style={{
                  padding: '7px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${preset === p.id ? 'var(--orange)' : 'var(--border)'}`,
                  background: preset === p.id ? 'var(--orange-bg)' : 'var(--surface)',
                  color: preset === p.id ? 'var(--orange)' : 'var(--text-muted)',
                }}
              >
                {p.label}
              </button>
            ))}
            <input type="date" value={fromDate} max={toDate} onChange={(e) => { setFromDate(e.target.value); setPreset(null); }}
              style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--text)' }} />
            <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>to</span>
            <input type="date" value={toDate} min={fromDate} max={toInputDate(new Date())} onChange={(e) => { setToDate(e.target.value); setPreset(null); }}
              style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--surface)', color: 'var(--text)' }} />
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            <button
              onClick={() => handleExport('csv')}
              disabled={!report || report.rows.length === 0 || exporting}
              style={btnStyle(!report || report.rows.length === 0)}
            >
              ⬇ CSV
            </button>
            <button
              onClick={() => handleExport('excel')}
              disabled={!report || report.rows.length === 0 || exporting}
              style={btnStyle(!report || report.rows.length === 0)}
            >
              ⬇ Excel
            </button>
            <button
              onClick={() => handleExport('pdf')}
              disabled={!report || report.rows.length === 0 || exporting}
              style={{ ...btnStyle(!report || report.rows.length === 0), background: 'var(--orange)', border: 'none', color: '#fff' }}
            >
              {exporting ? 'Preparing…' : '⬇ PDF'}
            </button>
          </div>

          {report && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
              <p style={{ margin: '0 0 2px', fontWeight: 700, fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 17 }}>{report.title}</p>
              <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>{report.subtitle}</p>

              {report.rows.length === 0 ? (
                <p style={{ color: 'var(--text-faint)', fontSize: 13.5 }}>No data for this period.</p>
              ) : (
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-alt)' }}>
                        {report.columns.map((c) => (
                          <th key={c.key} style={{ padding: '9px 12px', textAlign: c.align === 'right' ? 'right' : 'left', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row, idx) => (
                        <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                          {report.columns.map((c) => (
                            <td key={c.key} style={{ padding: '9px 12px', textAlign: c.align === 'right' ? 'right' : 'left', color: 'var(--text)', whiteSpace: 'nowrap' }}>
                              {row[c.key]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {report.totals && (
                      <tfoot>
                        <tr style={{ borderTop: '2px solid var(--heading)', fontWeight: 700 }}>
                          {report.columns.map((c) => (
                            <td key={c.key} style={{ padding: '9px 12px', textAlign: c.align === 'right' ? 'right' : 'left', color: 'var(--heading)' }}>
                              {report.totals[c.key] ?? ''}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </DashboardShell>
  );
}

function btnStyle(disabled) {
  return {
    background: 'var(--surface-alt)', border: '1px solid var(--border)', color: 'var(--text)',
    padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
  };
}
