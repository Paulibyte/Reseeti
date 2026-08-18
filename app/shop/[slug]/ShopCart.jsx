'use client';

import { useMemo, useState } from 'react';

function formatNaira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

// wa.me wants digits only, no '+' — same E.164-style normalization used
// elsewhere in the app (lib/twilioSms.js's toE164), just stripped of
// the leading '+' at the end since that's specifically what this one
// URL format wants.
function toWhatsAppDigits(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.startsWith('0')) return '234' + digits.slice(1);
  if (digits.startsWith('234')) return digits;
  return '234' + digits;
}

export default function ShopCart({ slug, businessName, businessAddress, whatsappNumber, canPayOnline, logoUrl, accentColor, products }) {
  const accent = accentColor || '#d97a2b';
  const [cart, setCart] = useState({}); // product_id -> qty
  const [showPhonePrompt, setShowPhonePrompt] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const grouped = useMemo(() => {
    const byCategory = {};
    for (const p of products) {
      const key = p.category || 'Products';
      if (!byCategory[key]) byCategory[key] = [];
      byCategory[key].push(p);
    }
    return byCategory;
  }, [products]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
      .filter((row) => row.product && row.qty > 0);
  }, [cart, products]);

  const total = cartItems.reduce((sum, row) => sum + row.product.price * row.qty, 0);
  const itemCount = cartItems.reduce((sum, row) => sum + row.qty, 0);

  function setQty(productId, qty) {
    setCart((prev) => ({ ...prev, [productId]: Math.max(0, qty) }));
  }

  function buildWhatsAppUrl() {
    const lines = cartItems.map(
      (row, i) => `${i + 1}. ${row.product.name}${row.product.unit_value ? ` (${row.product.unit_value}${row.product.unit || ''})` : ''} x${row.qty} — ${formatNaira(row.product.price * row.qty)}`
    );
    const message = [
      `New order from ${businessName}'s catalogue:`,
      '',
      ...lines,
      '',
      `Total: ${formatNaira(total)}`,
    ].join('\n');
    return `https://wa.me/${toWhatsAppDigits(whatsappNumber)}?text=${encodeURIComponent(message)}`;
  }

  // First tap just opens the phone-number prompt below the cart summary
  // — the actual submit happens in confirmViaWhatsApp() or payOnline().
  function startCheckout() {
    if (cartItems.length === 0) return;
    setShowPhonePrompt(true);
  }

  async function confirmViaWhatsApp() {
    if (!customerPhone || customerPhone.replace(/\D/g, '').length < 7) {
      setSubmitError('Enter a valid phone number so the seller can reach you.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');

    // Best-effort — the order record is a convenience for the seller's
    // dashboard (see schema_stage45.sql), not the actual communication
    // channel. If this fails (network hiccup, etc), the customer should
    // still be able to reach the seller via WhatsApp directly rather
    // than being blocked by a secondary feature failing.
    try {
      await fetch('/api/catalogue/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          customerPhone,
          customerName,
          items: cartItems.map((row) => ({ productId: row.product.id, qty: row.qty })),
        }),
      });
    } catch {
      // Swallowed on purpose — see comment above.
    }

    setSubmitting(false);
    window.open(buildWhatsAppUrl(), '_blank', 'noopener,noreferrer');
    setShowPhonePrompt(false);
  }

  // Unlike confirmViaWhatsApp, this one is NOT best-effort — a checkout
  // request that fails needs to actually stop and tell the customer,
  // since there's no WhatsApp fallback happening afterward to paper
  // over it. A real navigation (not window.open) to Paystack's own
  // checkout page, since this is a genuine payment flow, not a
  // convenience link.
  async function payOnline() {
    if (!customerPhone || customerPhone.replace(/\D/g, '').length < 7) {
      setSubmitError('Enter a valid phone number so the seller can reach you.');
      return;
    }
    if (!customerEmail || !/^\S+@\S+\.\S+$/.test(customerEmail)) {
      setSubmitError('Enter a valid email — Paystack sends your payment receipt there.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');

    try {
      const res = await fetch('/api/catalogue/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          customerPhone,
          customerName,
          customerEmail,
          items: cartItems.map((row) => ({ productId: row.product.id, qty: row.qty })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitting(false);
        setSubmitError(data.error || 'Could not start checkout.');
        return;
      }
      window.location.href = data.authorization_url;
    } catch {
      setSubmitting(false);
      setSubmitError('Could not start checkout — check your connection and try again.');
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', paddingBottom: itemCount > 0 ? 96 : 40, fontFamily: 'sans-serif', background: '#faf6ef', minHeight: '100vh' }}>
      <div style={{ height: 4, background: accent }} />
      <header style={{ padding: '28px 20px 20px', textAlign: 'center', borderBottom: '1px solid #e6ddd0' }}>
        {logoUrl && (
          <img src={logoUrl} alt="" style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 12, marginBottom: 12 }} />
        )}
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#1a2a4a' }}>{businessName}</h1>
        {businessAddress && <p style={{ margin: '6px 0 0', fontSize: 13, color: '#8a8175' }}>{businessAddress}</p>}
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: '#8a8175' }}>Pick what you need, then order below.</p>
      </header>

      <div style={{ padding: '16px 16px 0' }}>
        {products.length === 0 && (
          <p style={{ textAlign: 'center', color: '#8a8175', fontSize: 14, marginTop: 40 }}>Nothing in the catalogue yet — check back soon.</p>
        )}

        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#8a8175', margin: '0 0 8px 4px' }}>
              {category}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((p) => {
                const outOfStock = Number(p.stock_qty) <= 0;
                const qty = cart[p.id] || 0;
                const sizeLabel = p.unit_value ? `${p.unit_value}${p.unit || ''}` : (p.unit || null);
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                      padding: '12px 14px', background: '#fff', border: '1px solid #e6ddd0', borderRadius: 10,
                      opacity: outOfStock ? 0.55 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      {p.photo_url ? (
                        <img src={p.photo_url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 8, background: '#f5f0e8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                          🛍️
                        </div>
                      )}
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14.5, color: '#1a2a4a' }}>
                          {p.name}{sizeLabel ? ` (${sizeLabel})` : ''}
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: 13, color: '#8a8175' }}>
                          {formatNaira(p.price)}{outOfStock ? ' · Out of stock' : ''}
                        </p>
                      </div>
                    </div>
                    {!outOfStock && (
                      qty === 0 ? (
                        <button
                          onClick={() => setQty(p.id, 1)}
                          style={{ background: accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}
                        >
                          Add
                        </button>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <button onClick={() => setQty(p.id, qty - 1)} style={stepperBtn}>−</button>
                          <span style={{ minWidth: 18, textAlign: 'center', fontWeight: 700 }}>{qty}</span>
                          <button onClick={() => setQty(p.id, qty + 1)} style={stepperBtn}>+</button>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {itemCount > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e6ddd0', padding: '12px 16px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)' }}>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            {!showPhonePrompt ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 12, color: '#8a8175' }}>{itemCount} item{itemCount === 1 ? '' : 's'}</p>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 16, color: '#1a2a4a' }}>{formatNaira(total)}</p>
                </div>
                <button
                  onClick={startCheckout}
                  style={{ background: '#25D366', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 22px', fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}
                >
                  Order via WhatsApp
                </button>
              </div>
            ) : (
              <div>
                <p style={{ margin: '0 0 8px', fontSize: 12.5, color: '#6b6255', fontWeight: 600 }}>
                  So the seller can reach you.
                </p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    type="tel"
                    placeholder="Your phone number"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid #e6ddd0', borderRadius: 8, fontSize: 14 }}
                  />
                  <input
                    type="text"
                    placeholder="Your name (optional)"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    style={{ flex: 1, padding: '10px 12px', border: '1px solid #e6ddd0', borderRadius: 8, fontSize: 14 }}
                  />
                </div>
                {canPayOnline && (
                  <input
                    type="email"
                    placeholder="Your email (only needed to pay online)"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #e6ddd0', borderRadius: 8, fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }}
                  />
                )}
                {submitError && <p style={{ color: '#a63a3a', fontSize: 12.5, margin: '0 0 8px' }}>{submitError}</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {canPayOnline && (
                    <button
                      onClick={payOnline}
                      disabled={submitting}
                      style={{ background: accent, color: '#fff', border: 'none', borderRadius: 10, padding: '13px', fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}
                    >
                      {submitting ? 'Starting checkout…' : `Pay now — ${formatNaira(total)}`}
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={confirmViaWhatsApp}
                      disabled={submitting}
                      style={{ flex: 1, background: canPayOnline ? 'none' : '#25D366', border: canPayOnline ? '1px solid #25D366' : 'none', color: canPayOnline ? '#1a2a4a' : '#fff', borderRadius: 10, padding: '13px', fontWeight: 700, fontSize: 14.5, cursor: 'pointer' }}
                    >
                      {submitting ? 'Sending…' : canPayOnline ? 'Order via WhatsApp instead' : `Send order — ${formatNaira(total)}`}
                    </button>
                    <button
                      onClick={() => setShowPhonePrompt(false)}
                      style={{ background: 'none', border: '1px solid #e6ddd0', color: '#3a332c', borderRadius: 10, padding: '13px 16px', cursor: 'pointer' }}
                    >
                      Back
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 11, color: '#c4bcae', padding: '20px 0 0' }}>Powered by Reseeti</p>
    </main>
  );
}

const stepperBtn = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid #e6ddd0', background: '#faf6ef',
  fontWeight: 700, fontSize: 15, cursor: 'pointer', color: '#1a2a4a',
};
