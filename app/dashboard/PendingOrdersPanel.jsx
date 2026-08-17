'use client';

import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { csrfFetch } from '../../lib/csrfFetch';
import { formatNaira } from '../../lib/format';

export default function PendingOrdersPanel({ onClose, onConvert, onChanged }) {
  const supabase = createClient();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from('catalogue_orders')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setOrders(data || []);
    setLoading(false);
  }

  async function convert(order) {
    setBusyId(order.id);
    // Marked converted immediately, before the invoice is actually
    // saved — same tradeoff Park Sale's "Resume" makes. If the seller
    // backs out of the invoice form afterward, this order won't
    // reappear in the pending list; that's an acceptable edge case
    // rather than needing InvoiceForm to know about catalogue_orders
    // specifically just to handle a cancel.
    const res = await csrfFetch(`/api/catalogue/orders/${order.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'converted' }),
    });
    setBusyId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not convert this order.');
      return;
    }
    onChanged?.();

    // Builds the exact same shape InvoiceForm's resumeDraft prop
    // expects — this order becomes a pre-filled cart the seller just
    // reviews and saves, the same flow already built for resuming a
    // parked sale.
    const draft = {
      customerMode: 'walkin',
      customerId: null,
      customerName: order.customer_name || '',
      customerPhone: order.customer_phone || '',
      items: order.items.map((it) => ({
        description: it.name,
        qty: it.qty,
        price: it.price,
        product_id: it.product_id,
      })),
      discount: 0,
      shippingFee: 0,
      serviceChargeEnabled: false,
      serviceChargeRate: 0,
      vatEnabled: false,
      vatRate: 0,
      whtEnabled: false,
      whtRate: 0,
      estimatedDeliveryDate: '',
      loyaltyDiscountApplied: true,
    };
    onConvert(draft);
  }

  async function dismiss(order) {
    if (!confirm('Dismiss this order? Use this for spam, duplicates, or an order the customer cancelled.')) return;
    setBusyId(order.id);
    const res = await csrfFetch(`/api/catalogue/orders/${order.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed' }),
    });
    setBusyId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not dismiss this order.');
      return;
    }
    onChanged?.();
    setOrders((prev) => prev.filter((o) => o.id !== order.id));
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 460, width: '100%', borderTop: '5px solid var(--orange)', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, marginBottom: 2 }}>Catalogue orders</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          Orders customers placed from your online catalogue. Convert one into an invoice, or dismiss it.
        </p>

        <div style={{ overflowY: 'auto', flex: 1, marginBottom: 14 }}>
          {loading && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Loading…</p>}
          {!loading && orders.length === 0 && (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No pending orders right now.</p>
          )}
          {orders.map((o, idx) => (
            <div
              key={o.id}
              style={{ padding: '12px 2px', borderBottom: idx === orders.length - 1 ? 'none' : '1px solid var(--border)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                  {o.customer_name || 'Customer'} · {o.customer_phone}
                </p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(o.total)}</p>
              </div>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-faint)' }}>
                {o.items.map((it) => `${it.name} x${it.qty}`).join(', ')} · {new Date(o.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => convert(o)}
                  disabled={busyId === o.id}
                  style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  Convert to invoice
                </button>
                <button
                  onClick={() => dismiss(o)}
                  disabled={busyId === o.id}
                  style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '7px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer', alignSelf: 'flex-start' }}>
          Close
        </button>
      </div>
    </div>
  );
}
