'use client';

import { useEffect, useState } from 'react';
import { createClient } from '../../lib/supabaseClient';
import { queueDraftInvoice, syncQueue, getQueue } from '../../lib/offlineQueue';
import { parkSale } from '../../lib/parkedSales';
import { track } from '../../lib/analytics';
import { formatNaira, formatRate } from '../../lib/format';
import BarcodeScanInput from '../components/BarcodeScanInput';
import CameraBarcodeScanner, { isCameraScanningSupported } from '../components/CameraBarcodeScanner';
import { csrfFetch } from '../../lib/csrfFetch';

export default function InvoiceForm({ business, onClose, onSaved, resumeDraft, onParked }) {
  const supabase = createClient();
  // 'walkin' = quick sale, no customer profile attached (existing default
  // behavior, preserved for speed). 'existing' = picked someone from the
  // dropdown. 'new' = filling out a fresh profile inline before invoicing.
  const [customerMode, setCustomerMode] = useState(resumeDraft?.customerMode || 'walkin');
  const [customerId, setCustomerId] = useState(resumeDraft?.customerId ?? null);
  const [customerName, setCustomerName] = useState(resumeDraft?.customerName || '');
  const [customerPhone, setCustomerPhone] = useState(resumeDraft?.customerPhone || '');
  const [newCustomer, setNewCustomer] = useState(resumeDraft?.newCustomer || { name: '', phone: '', email: '', address: '', tax_id: '', notes: '' });
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [customerError, setCustomerError] = useState('');
  const [items, setItems] = useState(resumeDraft?.items || [{ description: '', qty: 1, price: '', product_id: null }]);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiWarnings, setAiWarnings] = useState([]);
  const [scanError, setScanError] = useState('');
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const cameraSupported = typeof window !== 'undefined' && isCameraScanningSupported();
  const [discount, setDiscount] = useState(resumeDraft?.discount ?? 0);
  const [shippingFee, setShippingFee] = useState(resumeDraft?.shippingFee ?? 0);
  const [serviceChargeEnabled, setServiceChargeEnabled] = useState(resumeDraft ? resumeDraft.serviceChargeEnabled : (business.service_charge_enabled || false));
  const [serviceChargeRate, setServiceChargeRate] = useState(resumeDraft?.serviceChargeRate ?? (business.default_service_charge_rate ?? 0));
  const [vatEnabled, setVatEnabled] = useState(resumeDraft ? resumeDraft.vatEnabled : (business.vat_enabled || false));
  const [vatRate, setVatRate] = useState(resumeDraft?.vatRate ?? (business.default_vat_rate ?? 7.5));
  const [whtEnabled, setWhtEnabled] = useState(resumeDraft ? resumeDraft.whtEnabled : (business.withholding_tax_enabled || false));
  const [whtRate, setWhtRate] = useState(resumeDraft?.whtRate ?? (business.default_withholding_tax_rate ?? 0));
  const [estimatedDeliveryDate, setEstimatedDeliveryDate] = useState(resumeDraft?.estimatedDeliveryDate || '');
  const [dueDate, setDueDate] = useState(resumeDraft?.dueDate || '');
  const [customFieldDefs, setCustomFieldDefs] = useState([]);
  // Keyed by field definition id — resumeDraft carries these forward as
  // the same self-contained {label, type, value} snapshot shape stored
  // on the invoice itself (see schema_stage52.sql), so a parked sale's
  // custom field values survive being resumed even if the underlying
  // field definition changed or was deleted in the meantime; matched
  // back to a live definition id here only when one still exists with
  // the same label, purely so the input re-populates correctly.
  const [customFieldValues, setCustomFieldValues] = useState(() => {
    const snapshot = resumeDraft?.customFieldValues || [];
    const byLabel = {};
    for (const f of snapshot) byLabel[f.label] = f.value;
    return byLabel;
  });

  // Builds the self-contained snapshot actually stored on the invoice —
  // only fields with a non-empty value are included, so an invoice with
  // no custom data ends up with a clean empty array rather than a pile
  // of blank entries.
  function buildCustomFieldSnapshot() {
    return customFieldDefs
      .map((def) => ({ label: def.label, type: def.field_type, value: customFieldValues[def.label] }))
      .filter((f) => f.value !== undefined && f.value !== '');
  }
  const [saving, setSaving] = useState(false);
  const [parking, setParking] = useState(false);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loyaltyPurchaseCount, setLoyaltyPurchaseCount] = useState(null);
  const [loyaltyDiscountApplied, setLoyaltyDiscountApplied] = useState(resumeDraft ? resumeDraft.loyaltyDiscountApplied : true);

  useEffect(() => {
    // Loaded once so item rows can offer inventory picks (native
    // <datalist>, degrades gracefully to plain typing if empty/offline)
    // and the customer dropdown can list existing profiles.
    (async () => {
      const { data: prods } = await supabase.from('products').select('id, name, price, barcode, stock_qty, type').eq('business_id', business.id);
      setProducts(prods || []);
      const { data: custs } = await supabase.from('customers').select('id, name, phone').eq('business_id', business.id).order('name');
      setCustomers(custs || []);
      const { data: fieldDefs } = await supabase.from('custom_field_definitions').select('*').eq('business_id', business.id).order('sort_order');
      setCustomFieldDefs(fieldDefs || []);
    })();
  }, [business.id]);

  useEffect(() => {
    // Only existing, previously-saved customers can be loyalty members —
    // a walk-in or a brand-new profile has no purchase history yet to
    // qualify on. Re-checks every time the selection changes so switching
    // between customers on the same invoice updates the banner correctly.
    if (!business.loyalty_enabled || customerMode !== 'existing' || !customerId) {
      setLoyaltyPurchaseCount(null);
      return;
    }
    (async () => {
      const { count } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', business.id)
        .eq('customer_id', customerId)
        .eq('paid', true);
      setLoyaltyPurchaseCount(count ?? 0);
      setLoyaltyDiscountApplied(true); // reset to "on" by default for each newly-qualifying customer
    })();
  }, [customerId, customerMode, business.id, business.loyalty_enabled]);

  function updateItem(idx, field, value) {
    const next = [...items];
    next[idx][field] = value;
    setItems(next);
  }

  // Called when a description matches a known product exactly (i.e. the
  // person picked it from the datalist rather than typing something new).
  // Auto-fills price and tags the row with product_id so the sale
  // decrements that product's stock once synced.
  function handleDescriptionChange(idx, value) {
    const match = products.find((p) => p.name === value || p.barcode === value);
    const next = [...items];
    next[idx].description = match ? match.name : value;
    if (match) {
      next[idx].price = match.price;
      next[idx].product_id = match.id;
    } else {
      next[idx].product_id = null;
    }
    setItems(next);
  }

  // Fired when the customer dropdown changes. The special values 'walkin'
  // and '__new__' switch mode; anything else is a customer id.
  function handleCustomerSelect(value) {
    setCustomerError('');
    if (value === 'walkin') {
      setCustomerMode('walkin');
      setCustomerId(null);
      setCustomerName('');
      setCustomerPhone('');
      return;
    }
    if (value === '__new__') {
      setCustomerMode('new');
      setCustomerId(null);
      return;
    }
    const match = customers.find((c) => c.id === value);
    setCustomerMode('existing');
    setCustomerId(match?.id ?? null);
    setCustomerName(match?.name || '');
    setCustomerPhone(match?.phone || '');
  }

  // Saves the inline "new customer" form as a real profile, then selects
  // it for this invoice — so the customer database and the invoice both
  // benefit from one entry, rather than typing the name twice.
  async function saveNewCustomer() {
    if (!newCustomer.name.trim()) {
      setCustomerError('Customer name is required.');
      return;
    }
    setCustomerError('');
    setSavingCustomer(true);
    const { data, error: err } = await supabase
      .from('customers')
      .insert({
        business_id: business.id,
        name: newCustomer.name,
        phone: newCustomer.phone || null,
        email: newCustomer.email || null,
        address: newCustomer.address || null,
        tax_id: newCustomer.tax_id || null,
        notes: newCustomer.notes || null,
      })
      .select()
      .single();
    setSavingCustomer(false);

    if (err) {
      setCustomerError(err.message.includes('duplicate') ? 'A customer with this phone number already exists.' : err.message);
      return;
    }

    setCustomers((prev) => [...prev, { id: data.id, name: data.name, phone: data.phone }].sort((a, b) => a.name.localeCompare(b.name)));
    setCustomerMode('existing');
    setCustomerId(data.id);
    setCustomerName(data.name);
    setCustomerPhone(data.phone || '');
    setNewCustomer({ name: '', phone: '', email: '', address: '', tax_id: '', notes: '' });
  }

  function addRow() {
    setItems([...items, { description: '', qty: 1, price: '', product_id: null }]);
  }

  function removeRow(idx) {
    setItems(items.filter((_, i) => i !== idx));
  }

  // Called by both BarcodeScanInput (any USB/Bluetooth HID scanner, or a
  // barcode typed by hand) and CameraBarcodeScanner (Chrome/Android
  // only). Looks the scanned code up against this business's actual
  // product catalog — a barcode that doesn't match anything shows an
  // error rather than getting added as a mystery freehand item, since a
  // wrong scan (or someone else's product barcode) silently becoming a
  // priced line item is exactly the kind of mistake that's easy to miss
  // until the customer's already paid the wrong amount.
  function handleBarcodeScan(code) {
    setScanError('');
    const product = products.find((p) => p.barcode === code);
    if (!product) {
      setScanError(`No product with barcode "${code}" — add it in Inventory first, or type the item in below.`);
      return;
    }

    setItems((prev) => {
      const existingIdx = prev.findIndex((it) => it.product_id === product.id);
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = { ...next[existingIdx], qty: Number(next[existingIdx].qty || 0) + 1 };
        return next;
      }
      // Replace a single still-empty default row rather than leaving a
      // blank row dangling above the newly-scanned item.
      const blankIdx = prev.findIndex((it) => !it.description && !it.product_id);
      const newRow = { description: product.name, qty: 1, price: product.price, product_id: product.id };
      if (blankIdx >= 0) {
        const next = [...prev];
        next[blankIdx] = newRow;
        return next;
      }
      return [...prev, newRow];
    });
  }

  // Sends the free-text sale description to the AI Invoice Assistant
  // (app/api/ai/parse-invoice/route.js) and replaces the current item
  // rows with what comes back. Replaces rather than merges — this is a
  // "give me a starting draft" tool used at the top of a fresh invoice,
  // not a way to append to items already being hand-edited; someone
  // partway through editing rows by hand wouldn't expect a second AI
  // pass to silently add more on top.
  //
  // Never fills in a price the AI wasn't confident about — an unmatched
  // item comes back with price: '' and is visibly flagged, so a
  // misheard/mistyped item can't turn into a wrong amount charged to a
  // customer without someone noticing before Save.
  async function runAIAssistant() {
    if (!aiText.trim()) return;
    setAiLoading(true);
    setAiError('');
    setAiWarnings([]);
    try {
      const res = await csrfFetch('/api/ai/parse-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not read that description.');

      setItems(data.items.map((it) => ({
        description: it.description,
        qty: it.qty || 1,
        price: it.price ?? '',
        product_id: it.product_id || null,
      })));
      if (data.customer_name && customerMode === 'walkin' && !customerName) {
        setCustomerName(data.customer_name);
      }
      setAiWarnings(data.warnings || []);
      setAiText('');
    } catch (err) {
      setAiError(err.message);
    }
    setAiLoading(false);
  }

  const subtotal = items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const loyaltyEligible = business.loyalty_enabled && loyaltyPurchaseCount !== null && loyaltyPurchaseCount >= (business.loyalty_purchase_threshold || 10);
  const loyaltyDiscountAmount = loyaltyEligible && loyaltyDiscountApplied
    ? subtotal * (Number(business.loyalty_discount_percent) || 0) / 100
    : 0;
  const netSubtotal = Math.max(subtotal - (Number(discount) || 0) - loyaltyDiscountAmount, 0);
  const serviceChargeAmount = serviceChargeEnabled ? netSubtotal * (Number(serviceChargeRate) || 0) / 100 : 0;
  // FIRS VAT base includes service charge (VAT applies to the full value
  // of the taxable supply, service charge included), but not shipping,
  // which is added as a flat pass-through cost after VAT.
  const vatAmount = vatEnabled ? (netSubtotal + serviceChargeAmount) * (Number(vatRate) || 0) / 100 : 0;
  const grossBeforeWht = netSubtotal + serviceChargeAmount + vatAmount + (Number(shippingFee) || 0);
  // Withholding tax is calculated on the goods/service value excluding
  // VAT, and reduces the amount actually payable — it's a deduction, not
  // an extra charge to the customer.
  const withholdingTaxAmount = whtEnabled ? netSubtotal * (Number(whtRate) || 0) / 100 : 0;
  const total = Math.max(grossBeforeWht - withholdingTaxAmount, 0);

  // Shown as a warning, not a hard block, since a business owner might
  // legitimately be selling something they haven't logged a restock for
  // yet and shouldn't be locked out of invoicing over it. Out-of-stock
  // gets distinct, more urgent wording than "running low."
  function stockWarning(item) {
    if (!item.product_id) return null;
    const product = products.find((p) => p.id === item.product_id);
    if (!product) return null;
    // Services (Stage 49) carry no real stock — nothing to warn about.
    if (product.type === 'service') return null;
    if (Number(product.stock_qty) <= 0) {
      return { level: 'danger', text: 'Out of stock — selling anyway will take stock negative' };
    }
    if (Number(item.qty) > Number(product.stock_qty)) {
      return { level: 'danger', text: `Only ${product.stock_qty} in stock` };
    }
    return null;
  }

  // Snapshots the raw, still-editable form state (not a computed invoice
  // draft — parking happens mid-cart, before checkout) so resuming later
  // restores exactly what was on screen, not a submitted sale's totals.
  async function parkCurrentSale() {
    setParking(true);
    await parkSale({
      customerMode, customerId, customerName, customerPhone, newCustomer,
      items, discount, shippingFee,
      serviceChargeEnabled, serviceChargeRate,
      vatEnabled, vatRate, whtEnabled, whtRate,
      estimatedDeliveryDate, loyaltyDiscountApplied, dueDate,
      customFieldValues: buildCustomFieldSnapshot(),
    }, customerMode === 'walkin' ? 'Walk-in' : customerName);
    setParking(false);
    track('sale_parked', {});
    onParked?.();
  }

  async function save() {
    if (customerMode === 'new') {
      setCustomerError('Finish adding the customer (or switch back to Walk-in) before saving the invoice.');
      return;
    }
    setSaving(true);
    const draft = {
      customer_id: customerId,
      customer_name: customerName,
      customer_phone: customerPhone,
      subtotal,
      discount: Number(discount) || 0,
      loyalty_discount_applied: loyaltyEligible && loyaltyDiscountApplied,
      loyalty_discount_amount: loyaltyDiscountAmount,
      service_charge_rate: serviceChargeEnabled ? Number(serviceChargeRate) || 0 : 0,
      service_charge_amount: serviceChargeAmount,
      vat_rate: vatEnabled ? Number(vatRate) || 0 : 0,
      vat_amount: vatAmount,
      shipping_fee: Number(shippingFee) || 0,
      withholding_tax_rate: whtEnabled ? Number(whtRate) || 0 : 0,
      withholding_tax_amount: withholdingTaxAmount,
      total,
      estimated_delivery_date: estimatedDeliveryDate || null,
      due_date: dueDate || null,
      custom_field_values: buildCustomFieldSnapshot(),
      items: items.filter((it) => it.description).map((it) => ({
        description: it.description,
        qty: Number(it.qty) || 1,
        price: Number(it.price) || 0,
        product_id: it.product_id || null,
      })),
    };

    // Always write to the local queue first — this never fails and never
    // waits on a network round trip, which is the whole point: the sale
    // is recorded the instant the button is tapped, connection or not.
    const queuedEntry = queueDraftInvoice(draft);
    track('invoice_created', { total });

    // If we're online, immediately try to push it (and anything else
    // still pending) to Supabase. If this fails or we're offline, the
    // draft just stays queued — the dashboard's sync-on-reconnect logic
    // will pick it up later, so nothing is lost either way.
    //
    // Wrapped in try/catch: navigator.onLine can report true even when
    // there's no real connectivity (it only checks for an active network
    // interface, not actual internet), so this whole block can still hit
    // network errors despite the check above. The invoice draft is
    // already safely queued locally at this point — a sync hiccup here
    // must never look like the sale itself failed.
    let depleted = [];
    if (navigator.onLine) {
      try {
        await syncQueue(supabase, business.id);

        // Stock deduction happens in a database trigger the instant the
        // invoice_items row lands — by now it's already applied. Re-check
        // just the products actually sold in this invoice to see whether
        // any of them landed at zero, so the dashboard can flag it right
        // when it happens rather than the owner discovering it days later
        // on the Inventory page.
        const soldProductIds = [...new Set(draft.items.map((it) => it.product_id).filter(Boolean))];
        if (soldProductIds.length) {
          const { data: refreshed } = await supabase
            .from('products')
            .select('name, stock_qty, type')
            .in('id', soldProductIds);
          // Services (Stage 49) always sit at stock_qty 0 — excluded here
          // so a service sale never wrongly shows up as "just ran out."
          depleted = (refreshed || []).filter((p) => p.type !== 'service' && Number(p.stock_qty) <= 0).map((p) => p.name);
        }
      } catch {
        // Sync (or the depleted-stock check) failed — the draft stays in
        // the local queue exactly as queueDraftInvoice left it, and will
        // be retried the next time syncQueue runs (page load, 'online'
        // event, or the next sale). Nothing to do here but let save()
        // finish normally instead of crashing the form.
      }
    }

    setSaving(false);
    // Still present in the queue after the sync attempt above means it
    // genuinely never made it to the server — either navigator.onLine
    // was false to begin with, or the sync attempt itself failed. Only
    // in that case does the caller get a reference to show an offline
    // receipt from; a successfully synced sale passes null here, and
    // nothing about that path's existing behavior changes.
    const stillQueued = getQueue().some((d) => d.localId === queuedEntry.localId);
    onSaved(depleted, stillQueued ? queuedEntry : null);
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: 20, marginBottom: 24 }}>
      <select
        value={customerMode === 'existing' ? customerId || '' : customerMode === 'new' ? '__new__' : 'walkin'}
        onChange={(e) => handleCustomerSelect(e.target.value)}
        style={{ ...inputStyle, cursor: 'pointer' }}
      >
        <option value="walkin">Walk-in customer (no profile)</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>
        ))}
        <option value="__new__">+ New customer…</option>
      </select>

      {customerMode === 'walkin' && (
        <>
          <input
            placeholder="Customer name (optional)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            style={inputStyle}
          />
          <input
            placeholder="Customer phone (optional)"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            style={inputStyle}
          />
        </>
      )}

      {customerMode === 'existing' && customerPhone && (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '-4px 0 10px' }}>{customerPhone}</p>
      )}

      {loyaltyEligible && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--success-bg)', border: '1px solid var(--success)', borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--success)', flex: 1 }}>
            🎉 {customerName} has made {loyaltyPurchaseCount} paid purchases — eligible for a {formatRate(business.loyalty_discount_percent)} loyalty discount.
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--success)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={loyaltyDiscountApplied} onChange={(e) => setLoyaltyDiscountApplied(e.target.checked)} />
            Apply
          </label>
        </div>
      )}

      {customerMode === 'new' && (
        <div style={{ background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 6, padding: 12, marginBottom: 10 }}>
          <input
            placeholder="Full name"
            value={newCustomer.name}
            onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="Phone"
            value={newCustomer.phone}
            onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
            style={inputStyle}
          />
          <input
            type="email"
            placeholder="Email (optional)"
            value={newCustomer.email}
            onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="Address (optional)"
            value={newCustomer.address}
            onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="Tax ID (optional)"
            value={newCustomer.tax_id}
            onChange={(e) => setNewCustomer({ ...newCustomer, tax_id: e.target.value })}
            style={inputStyle}
          />
          <textarea
            placeholder="Notes (optional)"
            value={newCustomer.notes}
            onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
          {customerError && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: -4 }}>{customerError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={saveNewCustomer}
              disabled={savingCustomer}
              style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              {savingCustomer ? 'Saving…' : 'Save & use this customer'}
            </button>
            <button
              type="button"
              onClick={() => { setCustomerMode('walkin'); setCustomerError(''); }}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
            🔢 Scan to add item
          </label>
          {cameraSupported && (
            <button
              type="button"
              onClick={() => setShowCameraScanner(true)}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
            >
              📷 Use camera
            </button>
          )}
        </div>
        <BarcodeScanInput onScan={handleBarcodeScan} placeholder="Scan with a barcode/QR scanner, or type a barcode and press Enter" />
        <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '6px 0 0' }}>
          Works with any USB or Bluetooth barcode/QR scanner — no setup needed, it just types into the box above.
          Scanning the same item again increases its quantity.
        </p>
        {scanError && <p style={{ color: 'var(--danger)', fontSize: 12.5, margin: '6px 0 0' }}>{scanError}</p>}
      </div>

      {showCameraScanner && (
        <CameraBarcodeScanner
          onDetected={(code) => { setShowCameraScanner(false); handleBarcodeScan(code); }}
          onClose={() => setShowCameraScanner(false)}
        />
      )}

      <div style={{ background: 'var(--orange-bg)', border: '1px solid var(--orange)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--orange-dark)', marginBottom: 6 }}>
          ✨ AI Invoice Assistant — describe the sale
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder='e.g. "Sold 2 bags of rice and one carton of milk"'
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runAIAssistant(); } }}
            style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
          />
          <button
            type="button"
            onClick={runAIAssistant}
            disabled={aiLoading || !aiText.trim()}
            style={{
              background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '0 16px',
              fontWeight: 700, fontSize: 13, cursor: aiLoading ? 'default' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {aiLoading ? 'Reading…' : 'Fill in'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--orange-dark)', margin: '6px 0 0', opacity: 0.85 }}>
          Matches items to your inventory where it can. This replaces the rows below — review before saving.
        </p>
        {aiError && <p style={{ color: 'var(--danger)', fontSize: 12.5, margin: '6px 0 0' }}>{aiError}</p>}
        {aiWarnings.map((w, i) => (
          <p key={i} style={{ color: 'var(--orange-dark)', fontSize: 12.5, margin: '6px 0 0', fontWeight: 600 }}>⚠ {w}</p>
        ))}
      </div>

      <datalist id="reseeti-products">
        {products.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>

      {items.map((it, idx) => {
        const warning = stockWarning(it);
        return (
          <div key={idx}>
            <div style={{ display: 'flex', gap: 8, marginBottom: warning ? 3 : 8 }}>
              <input
                list="reseeti-products"
                placeholder="Item — pick from inventory or type freely"
                value={it.description}
                onChange={(e) => handleDescriptionChange(idx, e.target.value)}
                style={{ ...inputStyle, flex: 3, marginBottom: 0 }}
              />
              <input
                type="number"
                placeholder="Qty"
                value={it.qty}
                onChange={(e) => updateItem(idx, 'qty', e.target.value)}
                style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
              />
              <input
                type="number"
                placeholder="Price"
                value={it.price}
                onChange={(e) => updateItem(idx, 'price', e.target.value)}
                style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
              />
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 18, cursor: 'pointer', padding: '0 6px' }}
                  title="Remove item"
                >
                  ×
                </button>
              )}
            </div>
            {warning && (
              <p style={{ fontSize: 11.5, color: 'var(--danger)', margin: '0 0 8px', fontWeight: warning.level === 'danger' ? 700 : 400 }}>⚠ {warning.text}</p>
            )}
          </div>
        );
      })}
      <button onClick={addRow} style={{ background: 'none', border: '1px dashed var(--border)', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', marginBottom: 12, color: 'var(--text)' }}>
        + Add item
      </button>

      <input
        type="number"
        placeholder="Discount (₦)"
        value={discount}
        onChange={(e) => setDiscount(e.target.value)}
        style={inputStyle}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 10 }}>
        <ChargeToggleRow
          label="Service charge"
          enabled={serviceChargeEnabled}
          onToggle={setServiceChargeEnabled}
          rate={serviceChargeRate}
          onRateChange={setServiceChargeRate}
        />
        <ChargeToggleRow
          label="VAT"
          enabled={vatEnabled}
          onToggle={setVatEnabled}
          rate={vatRate}
          onRateChange={setVatRate}
        />
        <ChargeToggleRow
          label="Withholding tax"
          enabled={whtEnabled}
          onToggle={setWhtEnabled}
          rate={whtRate}
          onRateChange={setWhtRate}
          isDeduction
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ flex: 1, fontSize: 14, color: 'var(--text)' }}>Shipping / delivery</label>
          <input
            type="number"
            min="0"
            placeholder="₦0"
            value={shippingFee}
            onChange={(e) => setShippingFee(e.target.value)}
            style={{ width: 100, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13.5, background: 'var(--bg)', color: 'var(--text)' }}
          />
        </div>
      </div>

      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
        Estimated delivery date <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span>
      </label>
      <input
        type="date"
        value={estimatedDeliveryDate}
        onChange={(e) => setEstimatedDeliveryDate(e.target.value)}
        style={inputStyle}
      />

      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
        Payment due date <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span>
      </label>
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        style={inputStyle}
      />

      {customFieldDefs.map((def) => (
        <div key={def.id}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            {def.label} <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span>
          </label>
          <input
            type={def.field_type === 'number' ? 'number' : def.field_type === 'date' ? 'date' : 'text'}
            value={customFieldValues[def.label] || ''}
            onChange={(e) => setCustomFieldValues((prev) => ({ ...prev, [def.label]: e.target.value }))}
            style={inputStyle}
          />
        </div>
      ))}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 4 }}>
        <BreakdownRow label="Subtotal" value={subtotal} />
        {Number(discount) > 0 && <BreakdownRow label="Discount" value={-Number(discount)} />}
        {loyaltyDiscountAmount > 0 && <BreakdownRow label={`Loyalty discount (${formatRate(business.loyalty_discount_percent)})`} value={-loyaltyDiscountAmount} />}
        {serviceChargeEnabled && serviceChargeAmount > 0 && (
          <BreakdownRow label={`Service charge (${formatRate(serviceChargeRate)})`} value={serviceChargeAmount} />
        )}
        {vatEnabled && vatAmount > 0 && <BreakdownRow label={`VAT (${formatRate(vatRate)})`} value={vatAmount} />}
        {Number(shippingFee) > 0 && <BreakdownRow label="Shipping" value={Number(shippingFee)} />}
        {whtEnabled && withholdingTaxAmount > 0 && (
          <BreakdownRow label={`Withholding tax (${formatRate(whtRate)})`} value={-withholdingTaxAmount} />
        )}
        <p style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18, color: 'var(--heading)', marginTop: 6 }}>
          <span>Total</span><span>{formatNaira(total)}</span>
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={save} disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}>
          {saving ? 'Saving…' : 'Save invoice'}
        </button>
        <button
          onClick={parkCurrentSale}
          disabled={parking}
          title="Set this sale aside and serve someone else — resume it later from Parked sales"
          style={{ background: 'none', border: '1px solid var(--orange)', color: 'var(--orange-dark)', padding: '10px 18px', borderRadius: 4, fontWeight: 700, cursor: 'pointer' }}
        >
          {parking ? 'Parking…' : '⏸ Park sale'}
        </button>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', padding: '10px 18px', borderRadius: 4, cursor: 'pointer', color: 'var(--text)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 14,
  marginBottom: 10,
  boxSizing: 'border-box',
  background: 'var(--bg)',
  color: 'var(--text)',
};

function ChargeToggleRow({ label, enabled, onToggle, rate, onRateChange, isDeduction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', fontSize: 14, color: 'var(--text)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {label}{isDeduction ? ' (deducted)' : ''}
      </label>
      <input
        type="number"
        min="0"
        step="0.1"
        value={rate}
        onChange={(e) => onRateChange(e.target.value)}
        disabled={!enabled}
        style={{ width: 70, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13.5, background: enabled ? 'var(--bg)' : 'var(--surface-alt)', color: 'var(--text)' }}
      />
      <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>%</span>
    </div>
  );
}

function BreakdownRow({ label, value }) {
  return (
    <p style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: 'var(--text-muted)', margin: '2px 0' }}>
      <span>{label}</span>
      <span>{value < 0 ? '- ' + formatNaira(-value) : formatNaira(value)}</span>
    </p>
  );
}
