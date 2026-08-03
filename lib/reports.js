import { formatNaira } from './format';

export const REPORT_TYPES = [
  { id: 'daily', label: 'Daily Sales' },
  { id: 'weekly', label: 'Weekly Sales' },
  { id: 'monthly', label: 'Monthly Sales' },
  { id: 'yearly', label: 'Yearly Sales' },
  { id: 'products', label: 'Product Sales' },
  { id: 'customers', label: 'Customer Ranking' },
  { id: 'debt', label: 'Outstanding Debt' },
  { id: 'inventory', label: 'Inventory Report' },
  { id: 'profit', label: 'Profit Report' },
  { id: 'expenses', label: 'Expense Report' },
  { id: 'tax', label: 'Tax Report' },
];

// Each of the four sales reports is the same underlying computation
// (buildSalesReport below) at a different grouping — this map is how the
// page picks the right groupBy for whichever one is selected, without a
// separate "group by" control the person has to also remember to set.
export const SALES_REPORT_GROUPING = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isoWeekLabel(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Groups a Date into a period key + display label for the requested
// granularity — the same underlying report answers "Daily sales,"
// "Weekly sales," "Monthly sales," and "Yearly sales" depending on which
// is picked, rather than needing four separate report types.
function periodOf(date, groupBy) {
  const d = new Date(date);
  if (groupBy === 'day') {
    const key = d.toISOString().slice(0, 10);
    return { key, label: fmtDate(d) };
  }
  if (groupBy === 'week') {
    const key = isoWeekLabel(d);
    return { key, label: key };
  }
  if (groupBy === 'year') {
    const key = String(d.getFullYear());
    return { key, label: key };
  }
  // month (default)
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { key, label: d.toLocaleDateString('en-NG', { month: 'short', year: 'numeric' }) };
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

const GROUPING_LABELS = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' };

// ---------- 1. Sales Report (daily / weekly / monthly / yearly) ----------
export function buildSalesReport(invoices, { from, to, groupBy }) {
  const inRangeInvoices = invoices.filter((i) => inRange(i.created_at, from, to));
  const map = {};
  inRangeInvoices.forEach((inv) => {
    const { key, label } = periodOf(inv.created_at, groupBy);
    if (!map[key]) map[key] = { key, label, count: 0, invoiced: 0, collected: 0 };
    map[key].count += 1;
    map[key].invoiced += Number(inv.total || 0);
    if (inv.paid) map[key].collected += Number(inv.total || 0);
  });
  const rows = Object.values(map).sort((a, b) => a.key.localeCompare(b.key)).map((r) => ({
    period: r.label,
    invoices: r.count,
    invoiced: formatNaira(r.invoiced),
    collected: formatNaira(r.collected),
    outstanding: formatNaira(r.invoiced - r.collected),
    _invoiced: r.invoiced,
    _collected: r.collected,
  }));
  const totalInvoiced = rows.reduce((s, r) => s + r._invoiced, 0);
  const totalCollected = rows.reduce((s, r) => s + r._collected, 0);
  return {
    title: `${GROUPING_LABELS[groupBy] || 'Sales'} Sales`,
    subtitle: `${fmtDate(from)} – ${fmtDate(to)}`,
    columns: [
      { key: 'period', label: 'Period' },
      { key: 'invoices', label: 'Invoices', align: 'right' },
      { key: 'invoiced', label: 'Invoiced', align: 'right' },
      { key: 'collected', label: 'Collected', align: 'right' },
      { key: 'outstanding', label: 'Outstanding', align: 'right' },
    ],
    rows,
    totals: {
      period: 'Total',
      invoices: inRangeInvoices.length,
      invoiced: formatNaira(totalInvoiced),
      collected: formatNaira(totalCollected),
      outstanding: formatNaira(totalInvoiced - totalCollected),
    },
  };
}

// ---------- 2. Product Sales ----------
export function buildProductSalesReport(items, invoicesById, { from, to }) {
  const map = {};
  items.forEach((it) => {
    const inv = invoicesById[it.invoice_id];
    if (!inv || !inRange(inv.created_at, from, to)) return;
    const key = it.description || 'Item';
    if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0 };
    map[key].qty += Number(it.qty || 0);
    map[key].revenue += Number(it.qty || 0) * Number(it.price || 0);
  });
  const sorted = Object.values(map).sort((a, b) => b.revenue - a.revenue);
  const totalQty = sorted.reduce((s, r) => s + r.qty, 0);
  const totalRevenue = sorted.reduce((s, r) => s + r.revenue, 0);
  return {
    title: 'Product Sales',
    subtitle: `${fmtDate(from)} – ${fmtDate(to)}`,
    columns: [
      { key: 'name', label: 'Product' },
      { key: 'qty', label: 'Qty sold', align: 'right' },
      { key: 'revenue', label: 'Revenue', align: 'right' },
    ],
    rows: sorted.map((r) => ({ name: r.name, qty: r.qty, revenue: formatNaira(r.revenue) })),
    totals: { name: 'Total', qty: totalQty, revenue: formatNaira(totalRevenue) },
  };
}

// ---------- 3. Customer Ranking ----------
export function buildCustomerRankingReport(invoices, { from, to }) {
  const inRangeInvoices = invoices.filter((i) => inRange(i.created_at, from, to));
  const map = {};
  inRangeInvoices.forEach((inv) => {
    const key = inv.customer_id || `legacy:${inv.customer_name || 'walk-in'}`;
    if (!map[key]) map[key] = { name: inv.customer_name || 'Walk-in', count: 0, total: 0 };
    map[key].count += 1;
    map[key].total += Number(inv.total || 0);
  });
  const sorted = Object.values(map).sort((a, b) => b.total - a.total);
  return {
    title: 'Customer Ranking',
    subtitle: `${fmtDate(from)} – ${fmtDate(to)}`,
    columns: [
      { key: 'rank', label: '#', align: 'right' },
      { key: 'name', label: 'Customer' },
      { key: 'count', label: 'Invoices', align: 'right' },
      { key: 'total', label: 'Total spent', align: 'right' },
    ],
    rows: sorted.map((r, idx) => ({ rank: idx + 1, name: r.name, count: r.count, total: formatNaira(r.total) })),
    totals: { rank: '', name: 'Total', count: inRangeInvoices.length, total: formatNaira(sorted.reduce((s, r) => s + r.total, 0)) },
  };
}

// ---------- 4. Outstanding Debt ----------
export function buildOutstandingDebtReport(invoices) {
  const unpaid = invoices.filter((i) => !i.paid);
  const map = {};
  unpaid.forEach((inv) => {
    const key = inv.customer_id || `legacy:${inv.customer_name || 'walk-in'}`;
    if (!map[key]) map[key] = { name: inv.customer_name || 'Walk-in', phone: inv.customer_phone || '', count: 0, total: 0, oldest: inv.created_at };
    map[key].count += 1;
    map[key].total += Number(inv.total || 0);
    if (new Date(inv.created_at) < new Date(map[key].oldest)) map[key].oldest = inv.created_at;
  });
  const now = new Date();
  const sorted = Object.values(map).sort((a, b) => b.total - a.total);
  const totalOwed = sorted.reduce((s, r) => s + r.total, 0);
  return {
    title: 'Outstanding Debt',
    subtitle: `As of ${fmtDate(now)}`,
    columns: [
      { key: 'name', label: 'Customer' },
      { key: 'phone', label: 'Phone' },
      { key: 'count', label: 'Unpaid invoices', align: 'right' },
      { key: 'daysOverdue', label: 'Days outstanding', align: 'right' },
      { key: 'total', label: 'Amount owed', align: 'right' },
    ],
    rows: sorted.map((r) => ({
      name: r.name,
      phone: r.phone,
      count: r.count,
      daysOverdue: Math.max(0, Math.floor((now - new Date(r.oldest)) / 86400000)),
      total: formatNaira(r.total),
    })),
    totals: { name: 'Total', phone: '', count: unpaid.length, daysOverdue: '', total: formatNaira(totalOwed) },
  };
}

// ---------- 5. Inventory Report (current snapshot, not date-ranged) ----------
export function buildInventoryReport(products) {
  const rows = [...products].sort((a, b) => a.name.localeCompare(b.name));
  const totalValue = rows.reduce((s, p) => s + Number(p.price || 0) * Number(p.stock_qty || 0), 0);
  return {
    title: 'Inventory Report',
    subtitle: `Snapshot as of ${fmtDate(new Date())}`,
    columns: [
      { key: 'name', label: 'Product' },
      { key: 'stock', label: 'Stock on hand', align: 'right' },
      { key: 'price', label: 'Selling price', align: 'right' },
      { key: 'value', label: 'Stock value', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    rows: rows.map((p) => {
      const qty = Number(p.stock_qty || 0);
      return {
        name: p.name,
        stock: qty,
        price: formatNaira(p.price),
        value: formatNaira(Number(p.price || 0) * qty),
        status: qty <= 0 ? 'Out of stock' : qty <= 5 ? 'Low stock' : 'In stock',
      };
    }),
    totals: { name: 'Total', stock: '', price: '', value: formatNaira(totalValue), status: '' },
  };
}

// ---------- 6. Profit Report ----------
// Mirrors Analytics' gross-profit computation exactly (same paid-invoice
// filter, same cost_price_at_sale-required rule) so the two never
// disagree on what "profit" means for the same data.
export function buildProfitReport(items, invoicesById, { from, to }) {
  const map = {};
  items.forEach((it) => {
    const inv = invoicesById[it.invoice_id];
    if (!inv || !inRange(inv.created_at, from, to)) return;
    const key = it.description || 'Item';
    if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0, cost: 0, hasCost: false };
    map[key].qty += Number(it.qty || 0);
    map[key].revenue += Number(it.qty || 0) * Number(it.price || 0);
    if (inv.paid && it.product_id && it.cost_price_at_sale !== null && it.cost_price_at_sale !== undefined) {
      map[key].cost += Number(it.cost_price_at_sale) * Number(it.qty || 0);
      map[key].hasCost = true;
    }
  });
  const sorted = Object.values(map).sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = sorted.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = sorted.reduce((s, r) => s + (r.hasCost ? r.revenue - r.cost : 0), 0);
  return {
    title: 'Profit Report',
    subtitle: `${fmtDate(from)} – ${fmtDate(to)} · Gross profit on paid invoices, items with a cost price only`,
    columns: [
      { key: 'name', label: 'Product' },
      { key: 'qty', label: 'Qty sold', align: 'right' },
      { key: 'revenue', label: 'Revenue', align: 'right' },
      { key: 'profit', label: 'Gross profit', align: 'right' },
    ],
    rows: sorted.map((r) => ({
      name: r.name,
      qty: r.qty,
      revenue: formatNaira(r.revenue),
      profit: r.hasCost ? formatNaira(r.revenue - r.cost) : 'No cost price set',
    })),
    totals: { name: 'Total', qty: sorted.reduce((s, r) => s + r.qty, 0), revenue: formatNaira(totalRevenue), profit: formatNaira(totalProfit) },
  };
}

// ---------- 7. Expense Report ----------
export function buildExpenseReport(expenses, { from, to }) {
  const inRangeExpenses = expenses.filter((e) => inRange(e.expense_date, from, to));
  const map = {};
  inRangeExpenses.forEach((e) => {
    const key = e.category || 'Uncategorized';
    if (!map[key]) map[key] = { category: key, count: 0, total: 0 };
    map[key].count += 1;
    map[key].total += Number(e.amount || 0);
  });
  const sorted = Object.values(map).sort((a, b) => b.total - a.total);
  const total = sorted.reduce((s, r) => s + r.total, 0);
  return {
    title: 'Expense Report',
    subtitle: `${fmtDate(from)} – ${fmtDate(to)}`,
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'count', label: 'Entries', align: 'right' },
      { key: 'total', label: 'Total', align: 'right' },
    ],
    rows: sorted.map((r) => ({ category: r.category, count: r.count, total: formatNaira(r.total) })),
    totals: { category: 'Total', count: inRangeExpenses.length, total: formatNaira(total) },
  };
}

// ---------- 8. Tax Report ----------
export function buildTaxReport(invoices, { from, to }) {
  const inRangeInvoices = invoices
    .filter((i) => inRange(i.created_at, from, to) && (Number(i.vat_amount) > 0 || Number(i.withholding_tax_amount) > 0))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const totalVat = inRangeInvoices.reduce((s, i) => s + Number(i.vat_amount || 0), 0);
  const totalWht = inRangeInvoices.reduce((s, i) => s + Number(i.withholding_tax_amount || 0), 0);
  return {
    title: 'Tax Report',
    subtitle: `${fmtDate(from)} – ${fmtDate(to)} · For VAT remittance and withholding tax records`,
    columns: [
      { key: 'invoice', label: 'Invoice #' },
      { key: 'date', label: 'Date' },
      { key: 'customer', label: 'Customer' },
      { key: 'subtotal', label: 'Subtotal', align: 'right' },
      { key: 'vatRate', label: 'VAT rate', align: 'right' },
      { key: 'vatAmount', label: 'VAT amount', align: 'right' },
      { key: 'whtRate', label: 'WHT rate', align: 'right' },
      { key: 'whtAmount', label: 'WHT amount', align: 'right' },
    ],
    rows: inRangeInvoices.map((i) => ({
      invoice: i.invoice_number,
      date: fmtDate(i.created_at),
      customer: i.customer_name || 'Walk-in',
      subtotal: formatNaira(i.subtotal),
      vatRate: i.vat_rate > 0 ? `${i.vat_rate}%` : '—',
      vatAmount: formatNaira(i.vat_amount),
      whtRate: i.withholding_tax_rate > 0 ? `${i.withholding_tax_rate}%` : '—',
      whtAmount: formatNaira(i.withholding_tax_amount),
    })),
    totals: {
      invoice: 'Total', date: '', customer: '', subtotal: '', vatRate: '',
      vatAmount: formatNaira(totalVat), whtRate: '', whtAmount: formatNaira(totalWht),
    },
  };
}
