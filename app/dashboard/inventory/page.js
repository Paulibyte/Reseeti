'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';
import { formatNaira } from '../../../lib/format';
import { cacheGetAll, cacheSetAll } from '../../../lib/idbCache';
import { useRealtimeSync } from '../../../lib/useRealtimeSync';

// Same reasoning as the customers list: paginate the rendered rows so a
// large catalog doesn't mean a large number of mounted DOM nodes.
const PAGE_SIZE = 25;

// Code splitting: UpgradeModal and ProductForm are both overlays that
// most inventory page loads never open (UpgradeModal only past the free
// limit; ProductForm only once "+ Add product" or an edit is clicked).
// Deferring both to their own chunks keeps the initial page load to just
// the product table itself.
const UpgradeModal = dynamic(() => import('../UpgradeModal'), { ssr: false });
const ProductForm = dynamic(() => import('./ProductForm'), { ssr: false });
const ImportModal = dynamic(() => import('../ImportModal'), { ssr: false });
const StockAdjustModal = dynamic(() => import('./StockAdjustModal'), { ssr: false });
const StockHistoryModal = dynamic(() => import('./StockHistoryModal'), { ssr: false });

export default function InventoryPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [products, setProducts] = useState([]);
  const [memberNames, setMemberNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [addVariantTo, setAddVariantTo] = useState(null); // { familyId, familyName } | null
  const [showImport, setShowImport] = useState(false);
  const [adjustingProduct, setAdjustingProduct] = useState(null);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [page, setPage] = useState(0);

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(0); }, [search]);

  // Live cross-device sync: a stock/price edit made on another device
  // (or a new product added there) merges into this device's list
  // directly — patching in place rather than a full reload, so this
  // device doesn't lose its current scroll/page position every time
  // something changes elsewhere. Conflict handling for edits made
  // offline on THIS device is separate — see handleProductSaved and
  // lib/offlineQueue.js's queueEdit/syncEdits.
  useRealtimeSync(supabase, 'products', business?.id, (payload) => {
    setProducts((prev) => {
      if (payload.eventType === 'DELETE') {
        return prev.filter((p) => p.id !== payload.old.id);
      }
      const exists = prev.some((p) => p.id === payload.new.id);
      if (exists) {
        return prev.map((p) => (p.id === payload.new.id ? payload.new : p));
      }
      return [...prev, payload.new].sort((a, b) => a.name.localeCompare(b.name));
    });
  });

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const cachedProducts = await cacheGetAll('products', biz.id);
    if (cachedProducts.length) {
      setProducts(cachedProducts);
      setLoading(false);
    }

    const { data: prods } = await supabase
      .from('products')
      .select('*')
      .eq('business_id', biz.id)
      .order('name');
    setProducts(prods || []);
    cacheSetAll('products', biz.id, prods || []);
    setLoading(false);

    // For resolving "who" in stock history (StockHistoryModal) without
    // a per-open fetch — a small, fairly static list, fine to load once
    // alongside the product catalog itself.
    const { data: members } = await supabase
      .from('business_members')
      .select('user_id, label, phone')
      .eq('business_id', biz.id);
    const names = {};
    for (const m of members || []) {
      names[m.user_id] = m.label || m.phone || 'A team member';
    }
    setMemberNames(names);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  async function deleteProduct(product) {
    if (!confirm(`Remove "${product.name}" from inventory? This won't affect past invoices.`)) return;
    await supabase.from('products').delete().eq('id', product.id);
    load();
  }

  const outOfStock = useMemo(
    () => products.filter((p) => Number(p.stock_qty) <= 0),
    [products]
  );
  const lowStock = useMemo(
    () => products.filter((p) => Number(p.stock_qty) > 0 && Number(p.stock_qty) <= Number(p.low_stock_threshold)),
    [products]
  );

  // Monetary value of everything currently on hand — at what it cost
  // to stock (cost_price × qty) and at what it would sell for
  // (price × qty) if sold at full price today. Products with no
  // cost_price recorded (it's optional — see ProductForm) are counted
  // in the selling-price total but excluded from the cost total, since
  // treating a missing cost as ₦0 would understate what's actually
  // invested in stock rather than just reflect incomplete data.
  const stockValue = useMemo(() => {
    let atCost = 0;
    let atSelling = 0;
    let missingCostCount = 0;
    for (const p of products) {
      const qty = Number(p.stock_qty) || 0;
      atSelling += qty * (Number(p.price) || 0);
      if (p.cost_price === null || p.cost_price === undefined || p.cost_price === '') {
        if (qty > 0) missingCostCount += 1;
      } else {
        atCost += qty * Number(p.cost_price);
      }
    }
    return { atCost, atSelling, potentialProfit: atSelling - atCost, missingCostCount };
  }, [products]);

  // Search matches name, category, or an exact/partial barcode — so typing
  // or scanning a code into this same box works as a quick lookup too,
  // without needing a separate "scan" mode.
  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    );
  });

  // Group variants of the same item (Stage 30's family_id) together so
  // "Rice 25kg" and "Rice 50kg" render as one card with two size rows,
  // not two unrelated products. A search match on any variant keeps the
  // whole family visible (so searching "rice" doesn't hide the 50kg
  // size just because the match was on the 25kg one's name/barcode).
  const familyOrder = [];
  const familyMap = {};
  for (const p of filtered) {
    const key = p.family_id || p.id;
    if (!familyMap[key]) {
      familyMap[key] = [];
      familyOrder.push(key);
    }
    familyMap[key].push(p);
  }
  const families = familyOrder.map((key) => familyMap[key].sort((a, b) => (a.unit_value || 0) - (b.unit_value || 0)));

  const totalPages = Math.max(1, Math.ceil(families.length / PAGE_SIZE));
  const pageFamilies = families.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!can(role, 'manageInventory', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to view this page.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides} onSignOut={signOut} onUpgradeClick={() => setShowUpgrade(true)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>
          Inventory
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowImport(true)}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px 14px', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            ⬆ Import
          </button>
          <button
            onClick={() => { setEditingProduct(null); setAddVariantTo(null); setShowForm(true); }}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
          >
            + Add product
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: '1 1 180px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
          <p style={{ margin: '0 0 2px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Stock value (cost)</p>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(stockValue.atCost)}</p>
          {stockValue.missingCostCount > 0 && (
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>
              {stockValue.missingCostCount} product{stockValue.missingCostCount === 1 ? '' : 's'} with stock but no cost price set — excluded
            </p>
          )}
        </div>
        <div style={{ flex: '1 1 180px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
          <p style={{ margin: '0 0 2px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Stock value (selling price)</p>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{formatNaira(stockValue.atSelling)}</p>
        </div>
        <div style={{ flex: '1 1 180px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
          <p style={{ margin: '0 0 2px', fontSize: 11.5, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Potential profit</p>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--success)' }}>{formatNaira(stockValue.potentialProfit)}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>If everything on hand sold at full price</p>
        </div>
      </div>

      {outOfStock.length > 0 && (
        <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontSize: 13 }}>
          <strong style={{ color: 'var(--danger)' }}>🚫 {outOfStock.length} product{outOfStock.length === 1 ? '' : 's'} out of stock:</strong>{' '}
          <span style={{ color: 'var(--text)' }}>
            {outOfStock.slice(0, 4).map((p) => p.name).join(', ')}
            {outOfStock.length > 4 ? ` and ${outOfStock.length - 4} more` : ''}
          </span>
        </div>
      )}

      {lowStock.length > 0 && (
        <div style={{ background: 'var(--orange-bg)', border: '1px solid var(--orange)', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 13 }}>
          <strong style={{ color: 'var(--orange-dark)' }}>⚠ {lowStock.length} product{lowStock.length === 1 ? '' : 's'} running low:</strong>{' '}
          <span style={{ color: 'var(--text)' }}>
            {lowStock.slice(0, 4).map((p) => p.name).join(', ')}
            {lowStock.length > 4 ? ` and ${lowStock.length - 4} more` : ''}
          </span>
        </div>
      )}

      <input
        placeholder="Search by name, category, or scan/type a barcode"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%', padding: '11px 14px', border: '1px solid var(--border)', borderRadius: 8,
          fontSize: 14, marginBottom: 18, boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)',
        }}
      />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {filtered.length === 0 && (
          <p style={{ color: 'var(--text-faint)', padding: 16, margin: 0 }}>
            {products.length === 0 ? 'No products yet — add your first one to start tracking stock.' : 'No matches.'}
          </p>
        )}
        {pageFamilies.map((variants, fIdx) => {
          const primary = variants[0];
          const isFamily = variants.length > 1;
          return (
            <div
              key={primary.family_id || primary.id}
              style={{ borderBottom: fIdx === pageFamilies.length - 1 ? 'none' : '1px solid var(--border)' }}
            >
              {isFamily && (
                <div style={{ padding: '10px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)', fontSize: 14.5 }}>
                    {primary.name} <span style={{ fontWeight: 500, color: 'var(--text-faint)', fontSize: 12 }}>({variants.length} sizes)</span>
                  </p>
                  <button
                    onClick={() => { setAddVariantTo({ familyId: primary.family_id || primary.id, familyName: primary.name }); setShowForm(true); }}
                    style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '4px 9px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 }}
                  >
                    + Add size
                  </button>
                </div>
              )}
              {variants.map((p, idx) => {
                const isOut = Number(p.stock_qty) <= 0;
                const isLow = !isOut && Number(p.stock_qty) <= Number(p.low_stock_threshold);
                const sizeLabel = p.unit_value ? `${p.unit_value}${p.unit || ''}` : (p.unit || null);
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                      padding: isFamily ? '10px 16px 10px 28px' : '13px 16px',
                      borderTop: isFamily && idx > 0 ? '1px dashed var(--border)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {p.photo_url && (
                        <img src={p.photo_url} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', flexShrink: 0 }} />
                      )}
                      <div>
                        <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', fontSize: 14.5 }}>
                          {isFamily ? (sizeLabel || 'Unspecified size') : p.name}
                        </p>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                          {!isFamily && sizeLabel ? `${sizeLabel} · ` : ''}
                          {p.category ? `${p.category} · ` : ''}
                          {p.barcode ? <span style={{ fontFamily: 'monospace' }}>{p.barcode}</span> : 'No barcode'}
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>{formatNaira(p.price)}</p>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: isOut ? 'var(--danger)' : isLow ? 'var(--orange-dark)' : 'var(--text-muted)' }}>
                          {isOut ? 'Out of stock' : `${p.stock_qty} in stock${isLow ? ' — low' : ''}`}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => setAdjustingProduct(p)}
                          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                        >
                          Adjust
                        </button>
                        <button
                          onClick={() => setHistoryProduct(p)}
                          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                        >
                          History
                        </button>
                        {!isFamily && (
                          <button
                            onClick={() => { setAddVariantTo({ familyId: p.family_id || p.id, familyName: p.name }); setShowForm(true); }}
                            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                          >
                            + Size
                          </button>
                        )}
                        <button
                          onClick={() => { setEditingProduct(p); setAddVariantTo(null); setShowForm(true); }}
                          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteProduct(p)}
                          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {families.length > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 14 }}>
          <button
            onClick={() => setPage((pg) => Math.max(0, pg - 1))}
            disabled={page === 0}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 12px', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.5 : 1, fontSize: 13 }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Page {page + 1} of {totalPages}</span>
          <button
            onClick={() => setPage((pg) => Math.min(totalPages - 1, pg + 1))}
            disabled={page >= totalPages - 1}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 12px', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1, fontSize: 13 }}
          >
            Next →
          </button>
        </div>
      )}

      {showForm && (
        <ProductForm
          business={business}
          product={editingProduct}
          familyId={addVariantTo?.familyId}
          familyName={addVariantTo?.familyName}
          onClose={() => { setShowForm(false); setAddVariantTo(null); }}
          onSaved={(queuedProduct) => {
            setShowForm(false);
            setAddVariantTo(null);
            // When ProductForm queued the edit offline (see its
            // _queuedOffline flag), it hands back the patched product so
            // this device's own view updates immediately rather than
            // waiting for a sync that can't happen until connectivity
            // returns — load() would just fail quietly while offline
            // anyway. Otherwise (a normal online save), reload from the
            // server as before.
            if (queuedProduct?._queuedOffline) {
              setProducts((prev) => prev.map((p) => (p.id === queuedProduct.id ? queuedProduct : p)));
            } else {
              load();
            }
          }}
        />
      )}
      {showImport && (
        <ImportModal
          title="Import products"
          table="products"
          business={business}
          supabase={supabase}
          onClose={() => setShowImport(false)}
          onImported={load}
          columns={[
            { key: 'name', required: true, example: 'Bag of rice (50kg)' },
            { key: 'barcode', example: '6009123456789' },
            { key: 'category', example: 'Groceries' },
            { key: 'price', required: true, example: '45000', transform: (v) => Number(v) || 0 },
            { key: 'cost_price', example: '38000', transform: (v) => (v === '' ? null : Number(v)) },
            { key: 'stock_qty', example: '20', transform: (v) => Number(v) || 0 },
            { key: 'low_stock_threshold', example: '5', transform: (v) => Number(v) || 5 },
          ]}
        />
      )}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      {adjustingProduct && (
        <StockAdjustModal
          product={adjustingProduct}
          onClose={() => setAdjustingProduct(null)}
          onAdjusted={(newStock) => {
            setProducts((prev) => prev.map((p) => (p.id === adjustingProduct.id ? { ...p, stock_qty: newStock } : p)));
            setAdjustingProduct(null);
          }}
        />
      )}
      {historyProduct && (
        <StockHistoryModal
          product={historyProduct}
          memberNames={memberNames}
          onClose={() => setHistoryProduct(null)}
        />
      )}
    </DashboardShell>
  );
}
