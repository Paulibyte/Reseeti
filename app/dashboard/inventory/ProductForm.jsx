'use client';

import { useState } from 'react';
import { createClient } from '../../../lib/supabaseClient';
import CameraBarcodeScanner, { isCameraScanningSupported } from '../../components/CameraBarcodeScanner';
import { queueEdit } from '../../../lib/offlineQueue';

export default function ProductForm({ business, product, familyId, familyName, onClose, onSaved }) {
  const supabase = createClient();
  const isEdit = !!product;
  const [form, setForm] = useState({
    type: product?.type || 'product',
    name: product?.name || familyName || '',
    barcode: product?.barcode || '',
    category: product?.category || '',
    price: product?.price ?? '',
    cost_price: product?.cost_price ?? '',
    stock_qty: product?.stock_qty ?? '',
    low_stock_threshold: product?.low_stock_threshold ?? 5,
    unit: product?.unit || '',
    unit_value: product?.unit_value ?? '',
    show_in_catalogue: product?.show_in_catalogue || false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const cameraSupported = typeof window !== 'undefined' && isCameraScanningSupported();

  // Photo — uploaded as a follow-up step after the product row itself
  // is saved (see save() below), not bundled into the same insert/
  // update call: a brand-new product has no id to build the storage
  // path from until after that first insert returns one.
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(product?.photo_url || '');
  const [removePhoto, setRemovePhoto] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Photo must be under 2MB.');
      return;
    }
    setPhotoFile(file);
    setRemovePhoto(false);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview('');
    setRemovePhoto(true);
  }

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      business_id: business.id,
      type: form.type,
      name: form.name,
      barcode: form.barcode || null,
      category: form.category || null,
      price: Number(form.price) || 0,
      cost_price: form.cost_price === '' ? null : Number(form.cost_price),
      // Services carry no real stock — kept at 0 rather than whatever
      // was last in the form, so switching a product to a service can't
      // accidentally leave a stale, meaningless quantity behind. See
      // schema_stage49.sql for why 0 is safe here: every stock-aware
      // display in the app already treats type==='service' as
      // "don't apply out-of-stock logic," not "read this number."
      stock_qty: form.type === 'service' ? 0 : (Number(form.stock_qty) || 0),
      low_stock_threshold: form.type === 'service' ? 0 : (Number(form.low_stock_threshold) || 0),
      unit: form.unit || null,
      unit_value: form.unit_value === '' ? null : Number(form.unit_value),
      show_in_catalogue: business.plan === 'pro' ? form.show_in_catalogue : false,
    };

    // Only set on creation, and only when this form was opened via
    // "+ Add variant" on an existing product (see inventory/page.js).
    // Never touched on edit — a variant's family_id shouldn't be
    // reassignable from this form; regrouping isn't a need this
    // reviewer feedback round asked for, and silently changing it here
    // would be an easy way to accidentally split or merge families.
    if (!isEdit && familyId) {
      payload.family_id = familyId;
    }

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
    //
    // A selected photo is silently dropped if this path is taken —
    // photo upload needs real connectivity regardless (it's a Storage
    // upload, not a queueable row change), so an edit made offline
    // still saves correctly, it just won't include a newly picked
    // photo until the next time this product is edited online.
    if (isEdit && typeof navigator !== 'undefined' && !navigator.onLine) {
      queueEdit({ table: 'products', id: product.id, changes: payload, baseUpdatedAt: product.updated_at });
      setSaving(false);
      onSaved({ ...product, ...payload, _queuedOffline: true });
      return;
    }

    const { data: saved, error: err } = isEdit
      ? await supabase.from('products').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', product.id).select('id').single()
      : await supabase.from('products').insert({ ...payload, updated_at: new Date().toISOString() }).select('id').single();

    if (err) {
      setSaving(false);
      setError(err.message.includes('duplicate') ? 'A product with this barcode already exists.' : err.message);
      return;
    }

    const productId = saved.id;

    if (photoFile) {
      setUploadingPhoto(true);
      const ext = photoFile.name.split('.').pop();
      const path = `${business.id}/products/${productId}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(path, photoFile, { upsert: true, cacheControl: '3600' });
      if (uploadError) {
        setUploadingPhoto(false);
        setSaving(false);
        setError(`Product saved, but the photo failed to upload: ${uploadError.message}`);
        return;
      }
      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path);
      // Cache-bust so the new photo shows immediately instead of a
      // stale browser-cached version at the same URL — same reasoning
      // as the existing logo upload in BusinessSettings.jsx.
      const freshUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      await supabase.from('products').update({ photo_url: freshUrl }).eq('id', productId);
      setUploadingPhoto(false);
    } else if (removePhoto) {
      await supabase.from('products').update({ photo_url: null }).eq('id', productId);
    }

    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 420, width: '100%', borderTop: '5px solid var(--orange)' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>
          {isEdit
            ? `Edit ${form.type === 'service' ? 'service' : 'product'}`
            : familyId ? `Add a size/variant of "${familyName}"` : 'Add product or service'}
        </h3>
        <form onSubmit={save}>
          {!familyId && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {['product', 'service'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('type', t)}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${form.type === t ? 'var(--orange)' : 'var(--border)'}`,
                    background: form.type === t ? 'var(--orange-bg)' : 'var(--bg)',
                    color: form.type === t ? 'var(--orange-dark)' : 'var(--text-muted)',
                  }}
                >
                  {t === 'product' ? '📦 Product' : '🛎️ Service'}
                </button>
              ))}
            </div>
          )}
          <label style={labelStyle}>{form.type === 'service' ? 'Service name' : 'Product name'}</label>
          <input required value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} placeholder={form.type === 'service' ? 'e.g. Consultation Fee' : 'e.g. Bag of Rice'} />

          {business.plan === 'pro' && (
            <>
              <label style={labelStyle}>Photo (optional)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                {photoPreview ? (
                  <img src={photoPreview} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                ) : (
                  <div style={{ width: 56, height: 56, borderRadius: 8, border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--text-faint)' }}>
                    📷
                  </div>
                )}
                <label style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '7px 12px', fontSize: 12.5, cursor: 'pointer' }}>
                  {photoPreview ? 'Change' : 'Add photo'}
                  <input type="file" accept="image/*" onChange={handlePhotoChange} disabled={uploadingPhoto} style={{ display: 'none' }} />
                </label>
                {photoPreview && (
                  <button type="button" onClick={clearPhoto} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12.5, cursor: 'pointer' }}>
                    Remove
                  </button>
                )}
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: -2, marginBottom: 14 }}>
                Shown on the public catalogue if this product is set to "Show in online catalogue" below. Under 2MB.
              </p>
            </>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Unit (optional)</label>
              <input value={form.unit} onChange={(e) => set('unit', e.target.value)} style={inputStyle} placeholder="e.g. kg, l, pcs, carton" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Unit size (optional)</label>
              <input type="number" min="0" step="any" value={form.unit_value} onChange={(e) => set('unit_value', e.target.value)} style={inputStyle} placeholder="e.g. 50" />
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: -6, marginBottom: 4 }}>
            {familyId
              ? 'This becomes another size of the same item — e.g. a 25kg bag alongside a 50kg bag.'
              : 'Fill these in if this item comes in a specific size (e.g. unit "kg", size "50" for a 50kg bag). You can add more sizes of the same item later from the Inventory list.'}
          </p>

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
            {form.type === 'product' && (
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
            )}
          </div>

          {form.type === 'product' && (
            <>
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
            </>
          )}

          {business.plan === 'pro' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, cursor: 'pointer', fontSize: 13.5, color: 'var(--text)' }}>
              <input type="checkbox" checked={form.show_in_catalogue} onChange={(e) => set('show_in_catalogue', e.target.checked)} />
              Show in online catalogue
            </label>
          )}

          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
              {uploadingPhoto ? 'Uploading photo…' : saving ? 'Saving…' : isEdit ? 'Save changes' : form.type === 'service' ? 'Add service' : 'Add product'}
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
