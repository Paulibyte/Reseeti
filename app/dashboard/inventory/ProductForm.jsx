'use client';

import { useState } from 'react';
import { createClient } from '../../../lib/supabaseClient';
import CameraBarcodeScanner, { isCameraScanningSupported } from '../../components/CameraBarcodeScanner';
import { queueEdit } from '../../../lib/offlineQueue';

export default function ProductForm({ business, product, onClose, onSaved }) {
  const supabase = createClient();
  const isEdit = !!product;
  const [form, setForm] = useState({
    name: product?.name || '',
    barcode: product?.barcode || '',
    category: product?.category || '',
    price: product?.price ?? '',
    cost_price: product?.cost_price ?? '',
    stock_qty: product?.stock_qty ?? '',
    low_stock_threshold: product?.low_stock_threshold ?? 5,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const cameraSupported = typeof window !== 'undefined' && isCameraScanningSupported();

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      business_id: business.id,
      name: form.name,
      barcode: form.barcode || null,
      category: form.category || null,
      price: Number(form.price) || 0,
      cost_price: form.cost_price === '' ? null : Number(form.cost_price),
      stock_qty: Number(form.stock_qty) || 0,
      low_stock_threshold: Number(form.low_stock_threshold) || 0,
    };

    // Editing an existing product while offline queues the change
    // instead of failing outright — see lib/offlineQueue.js's
    // queueEdit/syncEdits. baseUpdatedAt (this product's updated_at as
    // last loaded, before any edit) is what lets the eventual sync tell
    // "nobody else touched this since" from "someone changed it on
    // another device while I was offline" — see schema_stage26.sql's
    // set_updated_at triggers, which are what make updated_at reliable
    // enough to use this way. New products aren't queued this way — an
    // offline product creation queue is a reasonable future addition
    // (see README_STAGE26.md), not built in this stage.
    if (isEdit && typeof navigator !== 'undefined' && !navigator.onLine) {
      queueEdit({ table: 'products', id: product.id, changes: payload, baseUpdatedAt: product.updated_at });
      setSaving(false);
      onSaved({ ...product, ...payload, _queuedOffline: true });
      return;
    }

    const { error: err } = isEdit
      ? await supabase.from('products').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', product.id)
      : await supabase.from('products').insert({ ...payload, updated_at: new Date().toISOString() });

    setSaving(false);
    if (err) {
      setError(err.message.includes('duplicate') ? 'A product with this barcode already exists.' : err.message);
      return;
    }
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 420, width: '100%', borderTop: '5px solid var(--orange)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>
          {isEdit ? 'Edit product' : 'Add product'}
        </h3>
        <form onSubmit={save}>
          <label style={labelStyle}>Product name</label>
          <input required value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} placeholder="e.g. Bag of Rice (50kg)" />

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Price (₦)</label>
              <input required type="number" min="0" value={form.price} onChange={(e) => set('price', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Cost price (₦, optional)</label>
              <input type="number" min="0" value={form.cost_price} onChange={(e) => set('cost_price', e.target.value)} style={inputStyle} placeholder="What you paid for it" />
            </div>
          </div>
          {form.price && form.cost_price !== '' && Number(form.price) > 0 && (
            <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: -6, marginBottom: 4 }}>
              Margin: ₦{(Number(form.price) - Number(form.cost_price)).toLocaleString()} per unit
              ({(((Number(form.price) - Number(form.cost_price)) / Number(form.price)) * 100).toFixed(0)}%)
            </p>
          )}
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: form.price && form.cost_price !== '' ? 0 : -6, marginBottom: 10 }}>
            Cost price powers the Profit numbers on Analytics — leave it blank if you'd rather not track that.
          </p>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Category (optional)</label>
              <input value={form.category} onChange={(e) => set('category', e.target.value)} style={inputStyle} placeholder="e.g. Beverages" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Barcode (optional)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={form.barcode}
                  onChange={(e) => set('barcode', e.target.value)}
                  // A barcode scanner sends Enter right after the code —
                  // without this, that Enter would submit the whole form
                  // immediately, before price/stock/etc. are filled in
                  // for a new product.
                  onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                  style={{ ...inputStyle, fontFamily: 'monospace', flex: 1 }}
                  placeholder="Scan or type"
                />
                {cameraSupported && (
                  <button
                    type="button"
                    onClick={() => setShowCameraScanner(true)}
                    title="Scan with camera"
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '0 10px', cursor: 'pointer', fontSize: 15 }}
                  >
                    📷
                  </button>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Current stock</label>
              <input required type="number" min="0" value={form.stock_qty} onChange={(e) => set('stock_qty', e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Low stock alert at</label>
              <input type="number" min="0" value={form.low_stock_threshold} onChange={(e) => set('low_stock_threshold', e.target.value)} style={inputStyle} />
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: -6 }}>
            You'll see a low-stock warning once quantity on hand drops to or below this number.
          </p>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add product'}
            </button>
            <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      </div>

      {showCameraScanner && (
        <CameraBarcodeScanner
          onDetected={(code) => { setShowCameraScanner(false); set('barcode', code); }}
          onClose={() => setShowCameraScanner(false)}
        />
      )}
    </div>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 10 };
const inputStyle = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
  boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
};
