'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatNaira } from '../../lib/format';
import { can } from '../../lib/permissions';

const PAGE_SIZE = 30;
// Only render rows within this many pixels of the visible viewport. Rows
// outside this band are replaced with blank spacer height instead of real
// DOM nodes — this is what "virtualized" means here: the browser only
// ever has ~15-25 row elements mounted at once, regardless of whether the
// business has 50 invoices or 50,000.
const ROW_HEIGHT = 58;
const OVERSCAN_PX = 600;

// Columns kept intentionally narrow — this list exists to browse/act on
// invoices, not to duplicate everything the receipt page shows. No
// invoice_items join here at all (unlike the old dashboard query), since
// nothing in this row needs line items.
const SELECT_COLUMNS = 'id, invoice_number, customer_name, customer_phone, total, paid, last_reminded_at, created_at';

export default function VirtualInvoiceList({
  supabase,
  businessId,
  role,
  overrides,
  refreshToken,
  onTogglePaid,
  onDelete,
  onRemind,
  reminding,
}) {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const containerRef = useRef(null);
  const sentinelRef = useRef(null);

  const loadPage = useCallback(async (pageNum, replace) => {
    if (!businessId) return;
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('invoices')
      .select(SELECT_COLUMNS)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) { setHasMore(false); return; }

    setRows((prev) => (replace ? (data || []) : [...prev, ...(data || [])]));
    setHasMore((data || []).length === PAGE_SIZE);
  }, [supabase, businessId]);

  // A fresh business, or an action elsewhere (mark paid, delete, new
  // invoice saved) resets back to page 0 rather than trying to patch one
  // row into a paginated list in place — simpler, and this list is cheap
  // to re-fetch a page at a time.
  useEffect(() => {
    if (!businessId) return;
    setInitialLoading(true);
    setPage(0);
    setHasMore(true);
    loadPage(0, true).finally(() => setInitialLoading(false));
  }, [businessId, refreshToken, loadPage]);

  // Infinite scroll: an IntersectionObserver watches a 1px sentinel below
  // the last rendered row. Cheaper than a scroll-event listener (no
  // per-scroll JS at all — the browser only notifies us when the
  // sentinel actually crosses into view) and it keeps working correctly
  // if the row height ever changes.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && !initialLoading) {
        setLoadingMore(true);
        const next = page + 1;
        loadPage(next, false).then(() => setPage(next)).finally(() => setLoadingMore(false));
      }
    }, { rootMargin: `${OVERSCAN_PX}px` });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, initialLoading, page, loadPage]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight || 600);
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    const onResize = () => setViewportHeight(el.clientHeight || 600);
    window.addEventListener('resize', onResize);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [initialLoading]);

  // The actual windowing math: given scrollTop and viewport height, work
  // out which row indices are (nearly) visible, and only slice those out
  // of `rows` to render. startPad/endPad are spacer divs that stand in
  // for the un-rendered rows above/below so the scrollbar and scroll
  // position behave exactly as if every row were really mounted.
  const { visibleRows, startPad, endPad } = useMemo(() => {
    const overscanRows = Math.ceil(OVERSCAN_PX / ROW_HEIGHT);
    const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscanRows);
    const lastVisible = Math.min(
      rows.length,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + overscanRows
    );
    return {
      visibleRows: rows.slice(firstVisible, lastVisible).map((r, i) => ({ row: r, index: firstVisible + i })),
      startPad: firstVisible * ROW_HEIGHT,
      endPad: Math.max(0, (rows.length - lastVisible) * ROW_HEIGHT),
    };
  }, [rows, scrollTop, viewportHeight]);

  if (initialLoading) {
    return <div style={{ padding: 16, color: 'var(--text-faint)' }}>Loading invoices…</div>;
  }

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-faint)', padding: 16, margin: 0 }}>No invoices yet.</p>;
  }

  return (
    <div
      ref={containerRef}
      style={{ maxHeight: 480, overflowY: 'auto' }}
    >
      <div style={{ height: startPad }} />
      {visibleRows.map(({ row: inv, index }) => (
        <InvoiceRow
          key={inv.id}
          inv={inv}
          isLast={index === rows.length - 1}
          role={role}
          overrides={overrides}
          reminding={reminding}
          onTogglePaid={onTogglePaid}
          onDelete={onDelete}
          onRemind={onRemind}
        />
      ))}
      <div style={{ height: endPad }} />
      <div ref={sentinelRef} style={{ height: 1 }} />
      {loadingMore && (
        <div style={{ padding: 10, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
          Loading more…
        </div>
      )}
      {!hasMore && rows.length > PAGE_SIZE && (
        <div style={{ padding: 10, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
          That's all {rows.length} invoices.
        </div>
      )}
    </div>
  );
}

function InvoiceRow({ inv, isLast, role, overrides, reminding, onTogglePaid, onDelete, onRemind }) {
  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        padding: '12px 16px', borderBottom: isLast ? 'none' : '1px solid var(--border)',
        minHeight: 58, boxSizing: 'border-box',
      }}
    >
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--heading)' }}>{inv.invoice_number}</span>
      <span style={{ color: 'var(--text)' }}>{inv.customer_name}</span>
      <span style={{ fontWeight: 700, color: 'var(--text)' }}>{formatNaira(inv.total)}</span>
      <a
        href={`/inv/${inv.id}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: 12, color: 'var(--heading)', textDecoration: 'underline', fontWeight: 600 }}
      >
        Share
      </a>
      {!inv.paid && (
        <button
          onClick={() => onRemind(inv)}
          disabled={reminding === inv.id}
          title={inv.last_reminded_at ? `Last reminded ${new Date(inv.last_reminded_at).toLocaleDateString('en-NG')}` : 'No reminder sent yet'}
          style={{ fontSize: 12, background: 'none', border: '1px solid var(--orange)', color: 'var(--orange-dark)', borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontWeight: 600 }}
        >
          {reminding === inv.id ? 'Opening…' : 'Remind'}
        </button>
      )}
      <button
        onClick={() => onTogglePaid(inv)}
        disabled={!can(role, 'markInvoicePaid', overrides)}
        style={{
          fontSize: 11,
          padding: '4px 10px',
          borderRadius: 12,
          border: 'none',
          cursor: can(role, 'markInvoicePaid', overrides) ? 'pointer' : 'default',
          background: inv.paid ? 'var(--success-bg)' : 'var(--orange-bg)',
          color: inv.paid ? 'var(--success)' : 'var(--orange-dark)',
          fontWeight: 700,
        }}
      >
        {inv.paid ? 'PAID' : 'UNPAID'}
      </button>
      {can(role, 'deleteInvoice', overrides) && (
        <button
          onClick={() => onDelete(inv)}
          title="Delete invoice"
          style={{ fontSize: 12, background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontWeight: 600 }}
        >
          Delete
        </button>
      )}
    </div>
  );
}
