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

export default function InventoryPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [showImport, setShowImport] = useState(false);
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
    const { user, business: biz, role: myRole } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);

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
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  if (!can(role, 'manageInventory')) {
    return (
      <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to view this page.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut} onUpgradeClick={() => setShowUpgrade(true)}>
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
            onClick={() => { setEditingProduct(null); setShowForm(true); }}
            style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
          >
            + Add product
          </button>
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
        {pageItems.map((p, idx) => {
          const isOut = Number(p.stock_qty) <= 0;
          const isLow = !isOut && Number(p.stock_qty) <= Number(p.low_stock_threshold);
          return (
            <div
              key={p.id}
              style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '13px 16px', borderBottom: idx === pageItems.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              <div>
                <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', fontSize: 14.5 }}>{p.name}</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                  {p.category ? `${p.category} · ` : ''}
                  {p.barcode ? <span style={{ fontFamily: 'monospace' }}>{p.barcode}</span> : 'No barcode'}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>{formatNaira(p.price)}</p>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: isOut ? 'var(--danger)' : isLow ? 'var(--orange-dark)' : 'var(--text-muted)' }}>
                    {isOut ? 'Out of stock' : `${p.stock_qty} in stock${isLow ? ' — low' : ''}`}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => { setEditingProduct(p); setShowForm(true); }}
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

      {filtered.length > PAGE_SIZE && (
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
          onClose={() => setShowForm(false)}
          onSaved={(queuedProduct) => {
            setShowForm(false);
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
    </DashboardShell>
  );
}
