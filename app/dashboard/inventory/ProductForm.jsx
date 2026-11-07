'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '../../../lib/supabaseClient';
import CameraBarcodeScanner, { isCameraScanningSupported } from '../../components/CameraBarcodeScanner';
import { queueEdit } from '../../../lib/offlineQueue';
import { getMaxImageUploadMb, getMaxImageUploadBytes } from '../../../lib/maxUploadSize';
import { MAX_PRODUCT_PHOTOS, photosOf, photosChanged, movePhoto, makeCover, newPhotoPath, storagePathFor } from '../../../lib/productPhotos';
import { prepareImage } from '../../../lib/compressImage';
import { SALE_MODES, SALE_MODE_LABELS, MAX_TIERS, MAX_MOQ, validateWholesale } from '../../../lib/wholesalePricing';

export default function ProductForm({ business, product, familyId, familyName, onClose, onSaved }) {
  const supabase = createClient();
  const isEdit = !!product;
  const [form, setForm] = useState({
    type: product?.type || 'product',
    name: product?.name || familyName || '',
    description: product?.description || '',
    barcode: product?.barcode || '',
    category: product?.category || '',
    price: product?.price ?? '',
    cost_price: product?.cost_price ?? '',
    stock_qty: product?.stock_qty ?? '',
    low_stock_threshold: product?.low_stock_threshold ?? 5,
    is_serialized: product?.is_serialized || false,
    unit: product?.unit || '',
    unit_value: product?.unit_value ?? '',
    show_in_catalogue: product?.show_in_catalogue || false,
    // Bulk selling (lib/wholesalePricing.js). A product from before stage 63 has none of these and is simply retail.
    sale_mode: SALE_MODES.includes(product?.sale_mode) ? product.sale_mode : 'retail',
    moq: product?.moq ?? 1,
    tiers: Array.isArray(product?.price_tiers) ? product.price_tiers.map((t) => ({ min_qty: String(t.min_qty ?? ''), price: String(t.price ?? '') })) : [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const cameraSupported = typeof window !== 'undefined' && isCameraScanningSupported();

  // Photos. The product row is saved first and the files are uploaded after it: a brand-new product has no id to
  // build a storage path from until its first insert returns one. Each photo in the list is either one already saved
  // ({ url }) or one just chosen and waiting to upload ({ file }). The first photo is the cover.
  //
  // "This item needs several photos" is a switch: off, the form behaves as it always did (one photo); on, it becomes a
  // small gallery of up to MAX_PRODUCT_PHOTOS. A product that already has several photos opens with the switch on.
  const startPhotos = photosOf(product);
  const savedPhotos = useRef(startPhotos);   // what is saved right now (changes after a partly-failed save)
  const createdId = useRef(null);            // set once a NEW product row exists, so pressing Save again updates it instead of adding a duplicate
  const keyCounter = useRef(0);
  const nextKey = () => `photo-${++keyCounter.current}`;
  const [slots, setSlots] = useState(() => startPhotos.map((url) => ({ key: nextKey(), url, preview: url })));
  const [multi, setMulti] = useState(startPhotos.length > 1);
  const [photoNotice, setPhotoNotice] = useState('');
  // Photo changes need a connection, so the form says so the moment the connection is lost, even if it was already open.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(typeof navigator === 'undefined' || navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  // Displayed in the hint text below the photo field — fetched once on
  // mount so what's shown always matches the real, current admin
  // setting rather than a stale hardcoded number.
  const [maxUploadMb, setMaxUploadMb] = useState(2);
  useEffect(() => { getMaxImageUploadMb().then(setMaxUploadMb); }, []);

  // Previews of files that were chosen but never saved are released when the form closes.
  const slotsNow = useRef(slots);
  slotsNow.current = slots;
  useEffect(() => () => { slotsNow.current.forEach((s) => { if (s.file) URL.revokeObjectURL(s.preview); }); }, []);

  async function handleAddFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // so choosing the same file again still counts
    if (files.length === 0) return;
    setError('');
    setPhotoNotice('');
    const maxBytes = await getMaxImageUploadBytes();
    const mb = await getMaxImageUploadMb();
    const room = multi ? Math.max(0, MAX_PRODUCT_PHOTOS - slots.length) : 1;
    const picked = files.slice(0, room);
    const problems = [];
    if (files.length > picked.length) problems.push(`Only ${MAX_PRODUCT_PHOTOS} photos fit on one item, so ${files.length - picked.length} ${files.length - picked.length === 1 ? 'was' : 'were'} left out.`);
    const added = [];
    for (const original of picked) {
      if (!/^image\//i.test(original.type || '')) { problems.push(`${original.name} is not a picture.`); continue; }
      const file = await prepareImage(original); // shrinks big phone photos so they fit the limit
      if (file.size > maxBytes) { problems.push(`${original.name} is too big: each photo must be under ${mb}MB.`); continue; }
      added.push({ key: nextKey(), file, preview: URL.createObjectURL(file) });
    }
    if (added.length > 0) {
      setSlots((prev) => {
        if (multi) return [...prev, ...added].slice(0, MAX_PRODUCT_PHOTOS);
        prev.forEach((s) => { if (s.file) URL.revokeObjectURL(s.preview); });
        return added.slice(0, 1); // one-photo mode: the new photo replaces the old
      });
    }
    if (problems.length > 0) setPhotoNotice(problems.join(' '));
  }

  function removeSlot(i) {
    setSlots((prev) => {
      if (prev[i] && prev[i].file) URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, j) => j !== i);
    });
  }
  function moveSlot(i, to) { setSlots((prev) => movePhoto(prev, i, to)); }
  function coverSlot(i) { setSlots((prev) => makeCover(prev, i)); }

  function toggleMulti(on) {
    if (on) { setMulti(true); setPhotoNotice(''); return; }
    if (slots.length > 1 && !window.confirm(`Keep only the cover photo? The other ${slots.length - 1} will be removed when you save.`)) return;
    setSlots((prev) => {
      prev.slice(1).forEach((s) => { if (s.file) URL.revokeObjectURL(s.preview); });
      return prev.slice(0, 1);
    });
    setMulti(false);
    setPhotoNotice('');
  }

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }
  function setTier(i, field, value) {
    setForm((f) => ({ ...f, tiers: f.tiers.map((t, n) => (n === i ? { ...t, [field]: value } : t)) }));
  }
  function addTier() {
    setForm((f) => (f.tiers.length >= MAX_TIERS ? f : { ...f, tiers: [...f.tiers, { min_qty: '', price: '' }] }));
  }
  function removeTier(i) {
    setForm((f) => ({ ...f, tiers: f.tiers.filter((_, n) => n !== i) }));
  }

  // What the owner has entered for bulk selling, checked with the same rules the shop and the checkout use. A service is never sold in bulk.
  const wholesale = validateWholesale({ saleMode: form.type === 'service' ? 'retail' : form.sale_mode, moq: form.moq, tiers: form.tiers, price: form.price });
  // True if this product already had bulk settings stored (so turning them off must be saved too).
  const hadBulk = !!product && ((product.sale_mode && product.sale_mode !== 'retail') || Number(product.moq) > 1 || (Array.isArray(product.price_tiers) && product.price_tiers.length > 0));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      business_id: business.id,
      type: form.type,
      name: form.name,
      description: form.description.trim() || null,
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
      // Only meaningful for a real product — a service can't be
      // serialized, same reasoning as stock_qty above.
      is_serialized: form.type === 'product' ? form.is_serialized : false,
      unit: form.unit || null,
      unit_value: form.unit_value === '' ? null : Number(form.unit_value),
      show_in_catalogue: business.plan === 'pro' ? form.show_in_catalogue : false,
    };

    // The bulk-selling fields are sent ONLY when they are in use (or are being switched off). An ordinary product therefore saves
    // exactly the columns it always did, so nothing breaks for a shop whose database has not had the stage 63 update yet.
    if (!wholesale.ok) {
      setSaving(false);
      setError(wholesale.error);
      return;
    }
    if (wholesale.value.sale_mode !== 'retail' || hadBulk) {
      Object.assign(payload, wholesale.value);
    }

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

    // Once a new product's row exists, pressing Save again (after a photo problem) must update it, not add it twice.
    const rowId = isEdit ? product.id : createdId.current;
    const { data: saved, error: err } = rowId
      ? await supabase.from('products').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', rowId).select('id').single()
      : await supabase.from('products').insert({ ...payload, updated_at: new Date().toISOString() }).select('id').single();

    if (err) {
      setSaving(false);
      setError(err.message.includes('duplicate') ? 'A product with this barcode already exists.' : err.message);
      return;
    }

    const productId = saved.id;
    if (!isEdit) createdId.current = productId;

    // Photos: only touched when something about them changed (a photo added, removed, or the order or cover changed).
    const before = savedPhotos.current;
    const hasNewFiles = slots.some((sl) => sl.file);
    if (hasNewFiles || photosChanged(before, slots.map((sl) => sl.url))) {
      setUploadingPhoto(true);
      const total = slots.filter((sl) => sl.file).length;
      let done = 0;
      let failed = 0;
      let firstFailure = '';
      const finalUrls = [];
      const nextSlots = [];
      for (const sl of slots) {
        if (!sl.file) { finalUrls.push(sl.url); nextSlots.push(sl); continue; }
        done += 1;
        setUploadProgress(total > 1 ? `Uploading photo ${done} of ${total}…` : '');
        const path = newPhotoPath(business.id, productId, sl.file.name);
        const { error: uploadError } = await supabase.storage
          .from('logos')
          .upload(path, sl.file, { upsert: false, cacheControl: '31536000', contentType: sl.file.type || 'image/jpeg' });
        if (uploadError) {
          failed += 1;
          if (!firstFailure) firstFailure = uploadError.message;
          nextSlots.push(sl); // stays in the form so Save can try it again
          continue;
        }
        const { data: urlData } = supabase.storage.from('logos').getPublicUrl(path);
        finalUrls.push(urlData.publicUrl);
        nextSlots.push({ key: sl.key, url: urlData.publicUrl, preview: urlData.publicUrl });
      }

      let { error: photoErr } = await supabase.from('products').update({ photos: finalUrls, photo_url: finalUrls[0] || null }).eq('id', productId);
      let coverOnly = false;
      if (photoErr && /photos/i.test(photoErr.message || '')) {
        // The database has not had the stage 61 update yet, so it has no list of photos to save: keep the cover
        // photo only, exactly as the app always worked, rather than losing it too.
        coverOnly = true;
        ({ error: photoErr } = await supabase.from('products').update({ photo_url: finalUrls[0] || null }).eq('id', productId));
      }
      setUploadingPhoto(false);
      setUploadProgress('');

      if (photoErr) {
        setSlots(nextSlots);
        setSaving(false);
        setError(`The ${isEdit ? 'changes were' : 'product was'} saved, but its photos could not be: ${photoErr.message}`);
        return;
      }
      // Photos taken off the item are deleted from storage too (best effort: a failure here loses nothing).
      const paths = before.filter((u) => !finalUrls.includes(u)).map((u) => storagePathFor(u, business.id)).filter(Boolean);
      if (paths.length > 0) { try { await supabase.storage.from('logos').remove(paths); } catch { /* nothing to do */ } }
      savedPhotos.current = coverOnly ? finalUrls.slice(0, 1) : finalUrls;
      // With the older database only the cover could be saved. That is only worth a warning if there was more than one photo.
      const lostSome = coverOnly && finalUrls.length > 1;
      if (failed > 0 || lostSome) {
        setSlots(nextSlots);
        setSaving(false);
        setError(lostSome
          ? 'Saved, but only the cover photo could be kept: the database needs its latest update (stage 61) before an item can hold several photos.'
          : `The ${isEdit ? 'changes were' : 'product was'} saved, but ${failed} photo${failed === 1 ? '' : 's'} could not be uploaded (${firstFailure}). Press Save to try again.`);
        return;
      }
    }

    setSaving(false);
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 420, width: '100%', maxHeight: '90vh', overflowY: 'auto', borderTop: '5px solid var(--orange)', boxSizing: 'border-box' }}>
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

          <label style={labelStyle}>Short description (optional)</label>
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="Shown when a customer taps this item in your online catalogue"
          />

          {business.plan === 'pro' && (
            <>
              <label style={labelStyle}>{multi ? 'Photos (optional)' : 'Photo (optional)'}</label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--text)', marginBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" role="switch" checked={multi} onChange={(e) => toggleMulti(e.target.checked)} aria-label="This item needs several photos" style={{ marginTop: 2 }} />
                <span>
                  <b>This item needs several photos</b>{' '}
                  <span style={{ color: 'var(--text-faint)' }}>(cars, property, furniture, anything people want to see from every side)</span>
                </span>
              </label>

              {!multi ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                  {slots[0] ? (
                    <img src={slots[0].preview} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: 8, border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--text-faint)' }}>
                      📷
                    </div>
                  )}
                  <label style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '7px 12px', fontSize: 12.5, cursor: 'pointer' }}>
                    {slots[0] ? 'Change' : 'Add photo'}
                    <input type="file" accept="image/*" onChange={handleAddFiles} disabled={uploadingPhoto} style={{ display: 'none' }} />
                  </label>
                  {slots[0] && (
                    <button type="button" onClick={() => removeSlot(0)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12.5, cursor: 'pointer' }}>
                      Remove
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 6 }}>
                    {slots.map((sl, i) => (
                      <div key={sl.key} data-photo-tile style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 4, background: 'var(--bg)' }}>
                        <div style={{ position: 'relative' }}>
                          <img src={sl.preview} alt={`Photo ${i + 1}`} style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                          {i === 0 && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--orange)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4 }}>Cover</span>}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 2, marginTop: 4 }}>
                          <button type="button" aria-label={`Move photo ${i + 1} earlier`} disabled={i === 0} onClick={() => moveSlot(i, i - 1)} style={tinyBtn}>◀</button>
                          <button type="button" aria-label={`Move photo ${i + 1} later`} disabled={i === slots.length - 1} onClick={() => moveSlot(i, i + 1)} style={tinyBtn}>▶</button>
                          <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => removeSlot(i)} style={{ ...tinyBtn, color: 'var(--danger)' }}>✕</button>
                        </div>
                        {i > 0 && <button type="button" onClick={() => coverSlot(i)} style={{ ...tinyBtn, width: '100%', marginTop: 3 }}>Make cover</button>}
                      </div>
                    ))}
                    {slots.length < MAX_PRODUCT_PHOTOS && (
                      <label style={{ border: '1px dashed var(--border)', borderRadius: 8, minHeight: 96, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', textAlign: 'center', padding: 4 }}>
                        <span style={{ fontSize: 22, lineHeight: 1 }}>＋</span>
                        <span>Add photos</span>
                        <input type="file" accept="image/*" multiple onChange={handleAddFiles} disabled={uploadingPhoto} style={{ display: 'none' }} />
                      </label>
                    )}
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 4px' }}>{slots.length} of {MAX_PRODUCT_PHOTOS} photos. The first is the cover, shown on the shop page.</p>
                </div>
              )}

              {photoNotice && <p role="status" style={{ fontSize: 12, color: 'var(--danger)', margin: '4px 0' }}>{photoNotice}</p>}
              {!online && isEdit && (
                <p role="status" style={{ fontSize: 12, color: 'var(--orange-dark)', margin: '4px 0' }}>You are offline. Your other changes will be saved, but photo changes need an internet connection: make them again when you are back online.</p>
              )}
              <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2, marginBottom: 14 }}>
                Shown on the public catalogue if this product is set to "Show in online catalogue" below. Big photos are shrunk automatically; each must end up under {maxUploadMb}MB.
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

          {form.type !== 'service' && (
            <div data-testid="wholesale-section" style={{ border: '1px solid var(--border, #e6ddd0)', borderRadius: 10, padding: '10px 12px', margin: '4px 0 12px' }}>
              <label style={labelStyle}>How do you sell this?</label>
              <select aria-label="How do you sell this?" value={form.sale_mode} onChange={(e) => set('sale_mode', e.target.value)} style={inputStyle}>
                {SALE_MODES.map((m) => (
                  <option key={m} value={m}>{SALE_MODE_LABELS[m]}</option>
                ))}
              </select>
              {form.sale_mode !== 'retail' && (
                <div style={{ marginTop: 8 }}>
                  {form.sale_mode === 'wholesale' && (
                    <div style={{ marginBottom: 8 }}>
                      <label style={labelStyle}>Smallest order (how many units)</label>
                      <input aria-label="Smallest order" type="number" min="1" max={MAX_MOQ} step="1" value={form.moq} onChange={(e) => set('moq', e.target.value)} style={inputStyle} />
                    </div>
                  )}
                  <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 6px' }}>
                    Bulk prices (optional): from this many units, each one costs less than the normal price above.
                  </p>
                  {form.tiers.map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                      <input aria-label={`Bulk price ${i + 1} starts from (quantity)`} type="number" min="2" max={MAX_MOQ} step="1" placeholder="From quantity" value={t.min_qty} onChange={(e) => setTier(i, 'min_qty', e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                      <input aria-label={`Bulk price ${i + 1} (₦ each)`} type="number" min="0" step="any" placeholder="₦ each" value={t.price} onChange={(e) => setTier(i, 'price', e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                      <button type="button" aria-label={`Remove bulk price ${i + 1}`} onClick={() => removeTier(i)} style={{ border: 'none', background: 'none', color: 'var(--text-faint)', fontSize: 18, cursor: 'pointer' }}>×</button>
                    </div>
                  ))}
                  {form.tiers.length < MAX_TIERS && (
                    <button type="button" onClick={addTier} style={{ border: 'none', background: 'none', color: 'var(--accent, #0f766e)', fontWeight: 700, fontSize: 13, cursor: 'pointer', padding: 0 }}>
                      + Add a bulk price
                    </button>
                  )}
                  {!wholesale.ok && form.price !== '' && (
                    <p data-testid="wholesale-error" style={{ fontSize: 12.5, color: '#b42318', margin: '8px 0 0' }}>{wholesale.error}</p>
                  )}
                  {wholesale.ok && wholesale.warnings.map((w) => (
                    <p key={w} data-testid="wholesale-warning" style={{ fontSize: 12.5, color: '#92600a', margin: '8px 0 0' }}>{w}</p>
                  ))}
                </div>
              )}
            </div>
          )}

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
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, cursor: 'pointer', fontSize: 13.5, color: 'var(--text)' }}>
                <input type="checkbox" checked={form.is_serialized} onChange={(e) => set('is_serialized', e.target.checked)} />
                Track individual units (serial number / IMEI) — for phones, laptops, and similar items
              </label>
              {form.is_serialized && (
                <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: -6 }}>
                  Add each physical unit's serial number, IMEI, and supplier from the Device Units page after saving. Current stock above becomes a display-only total once units are added — the real count comes from how many unsold units exist.
                </p>
              )}
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
              {uploadingPhoto ? (uploadProgress || 'Uploading photo…') : saving ? 'Saving…' : isEdit ? 'Save changes' : form.type === 'service' ? 'Add service' : 'Add product'}
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
const tinyBtn = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', fontSize: 11, lineHeight: 1, padding: '5px 6px', cursor: 'pointer' };
