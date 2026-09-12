'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import EditDeviceUnitModal from './EditDeviceUnitModal';

const ImportModal = dynamic(() => import('../ImportModal'), { ssr: false });

const inputStyle = { padding: '8px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' };
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 };

// Matches on name only after collapsing ALL whitespace (not just
// trimming the edges) into single regular spaces, and lowercasing.
// Plain .trim() only strips leading/trailing whitespace — a stray
// non-breaking space or double space in the MIDDLE of a name (common
// from copy-pasting product names into a spreadsheet) looks completely
// identical on screen but silently fails a strict comparison. \s in a
// regex already matches non-breaking spaces too, so this one line
// covers the whole class of "looks the same, isn't the same" mismatch.
function normalizeForMatch(s) {
  return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
}

function blankUnit() {
  return { serial_number: '', imei1: '', imei2: '', color: '', condition: 'new', specs: '', cost_price: '' };
}

export default function DeviceUnitsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [rows, setRows] = useState([blankUnit()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [existingUnits, setExistingUnits] = useState([]);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (selectedProductId) loadUnitsForProduct(selectedProductId); else setExistingUnits([]); }, [selectedProductId]);

  async function load() {
    const { user, business: biz, role: r } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(r);

    const { data: prods } = await supabase
      .from('products')
      .select('id, name')
      .eq('business_id', biz.id)
      .eq('is_serialized', true)
      .order('name');
    setProducts(prods || []);

    const { data: sups } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('business_id', biz.id)
      .order('name');
    setSuppliers(sups || []);
    setLoading(false);
  }

  // Sold status is derived, not stored — a unit is sold if any
  // invoice_items row references it (see schema_device_dealers.sql).
  async function loadUnitsForProduct(productId) {
    setLoadingUnits(true);
    const { data } = await supabase
      .from('device_units')
      .select('*, invoice_items(id, invoices(customer_name, created_at)), suppliers(name)')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });
    setExistingUnits(data || []);
    setLoadingUnits(false);
  }

  function updateRow(idx, field, value) {
    const next = [...rows];
    next[idx][field] = value;
    setRows(next);
  }

  function addRow() { setRows([...rows, blankUnit()]); }
  function removeRow(idx) { setRows(rows.filter((_, i) => i !== idx)); }

  const [editingUnit, setEditingUnit] = useState(null);

  // Blocked for sold units on purpose — deleting one would destroy the
  // exact record (which customer, which invoice) that the Serial/IMEI
  // Lookup tool exists to preserve. An unsold unit is just a stock
  // record with nothing tying it to a real transaction yet, so
  // removing a genuine data-entry mistake there is safe.
  async function deleteUnit(unit, sold) {
    if (sold) return;
    if (!confirm(`Delete unit ${unit.serial_number}? This cannot be undone.`)) return;
    const { error: dbError } = await supabase.from('device_units').delete().eq('id', unit.id);
    if (dbError) {
      alert(dbError.message);
      return;
    }
    loadUnitsForProduct(selectedProductId);
  }

  async function save() {
    setError('');
    const cleaned = rows.filter((r) => r.serial_number.trim());
    if (!selectedProductId) { setError('Choose which product these units belong to.'); return; }
    if (cleaned.length === 0) { setError('Add at least one unit with a serial number.'); return; }

    setSaving(true);
    const { error: dbError } = await supabase.from('device_units').insert(
      cleaned.map((r) => ({
        business_id: business.id,
        product_id: selectedProductId,
        supplier_id: selectedSupplierId || null,
        serial_number: r.serial_number.trim(),
        imei1: r.imei1.trim() || null,
        imei2: r.imei2.trim() || null,
        color: r.color.trim() || null,
        condition: r.condition || null,
        specs: r.specs.trim() || null,
        cost_price: r.cost_price === '' ? null : Number(r.cost_price),
      }))
    );
    setSaving(false);
    if (dbError) { setError(dbError.message); return; }
    setRows([blankUnit()]);
    loadUnitsForProduct(selectedProductId);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
    <div style={{ padding: 20, maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>Device Units</h1>
        {products.length > 0 && (
          <button
            onClick={() => setShowImport(true)}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '7px 14px', fontSize: 12.5, cursor: 'pointer' }}
          >
            ⬆ Import
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>
        Record each physical unit — serial number, IMEI, color — when new stock comes in. Only products marked "Track individual units" in Inventory appear here.
      </p>

      {products.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>
          No serialized products yet — edit a product in Inventory and turn on "Track individual units" first.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Product</label>
              <select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                <option value="">Choose a product…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Supplier (optional)</label>
              <select value={selectedSupplierId} onChange={(e) => setSelectedSupplierId(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                <option value="">No supplier recorded</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {selectedProductId && (
            <>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
                <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-muted)', margin: '0 0 10px', textTransform: 'uppercase' }}>Add units received</p>
                {rows.map((row, idx) => (
                  // A wrapping flex row, not a rigid fixed-column grid —
                  // on a narrower available width (a smaller window, or
                  // the app's own floating Feedback tab eating into the
                  // right edge of the screen), fields naturally drop to
                  // a new line instead of getting squeezed or hidden
                  // behind whatever else is competing for that space.
                  <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                    <input value={row.serial_number} onChange={(e) => updateRow(idx, 'serial_number', e.target.value)} placeholder="Serial number *" style={{ ...inputStyle, flex: '1 1 150px' }} />
                    <input value={row.imei1} onChange={(e) => updateRow(idx, 'imei1', e.target.value)} placeholder="IMEI 1" style={{ ...inputStyle, flex: '1 1 120px' }} />
                    <input value={row.imei2} onChange={(e) => updateRow(idx, 'imei2', e.target.value)} placeholder="IMEI 2" style={{ ...inputStyle, flex: '1 1 120px' }} />
                    <input value={row.color} onChange={(e) => updateRow(idx, 'color', e.target.value)} placeholder="Color" style={{ ...inputStyle, flex: '1 1 100px' }} />
                    <select value={row.condition} onChange={(e) => updateRow(idx, 'condition', e.target.value)} style={{ ...inputStyle, flex: '1 1 100px' }}>
                      <option value="new">New</option>
                      <option value="used">Used</option>
                      <option value="refurbished">Refurbished</option>
                    </select>
                    <input value={row.specs} onChange={(e) => updateRow(idx, 'specs', e.target.value)} placeholder="e.g. 128GB, 8GB RAM" style={{ ...inputStyle, flex: '1 1 150px' }} />
                    <input type="number" min="0" value={row.cost_price} onChange={(e) => updateRow(idx, 'cost_price', e.target.value)} placeholder="Cost" style={{ ...inputStyle, flex: '1 1 90px' }} />
                    {rows.length > 1 && (
                      <button onClick={() => removeRow(idx)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 18, cursor: 'pointer', flexShrink: 0 }}>×</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={addRow} style={{ background: 'none', border: '1px dashed var(--border)', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', color: 'var(--text)', fontSize: 12.5, marginBottom: 10 }}>
                  + Add another unit
                </button>
                {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
                <div>
                  <button onClick={save} disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                    {saving ? 'Saving…' : 'Save units'}
                  </button>
                </div>
              </div>

              <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-muted)', margin: '0 0 8px', textTransform: 'uppercase' }}>Existing units for this product</p>
              {loadingUnits ? (
                <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Loading…</p>
              ) : existingUnits.length === 0 ? (
                <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>No units recorded yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {existingUnits.map((u) => {
                    const sold = !!u.invoice_items?.length;
                    return (
                      <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, gap: 10 }}>
                        <span style={{ color: 'var(--text)' }}>
                          {u.serial_number}{u.color ? ` · ${u.color}` : ''}{u.condition ? ` · ${u.condition}` : ''}
                          {u.suppliers?.name ? ` · from ${u.suppliers.name}` : ''}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <span style={{
                            fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase',
                            background: sold ? 'var(--success-bg)' : 'var(--orange-bg)', color: sold ? 'var(--success)' : 'var(--orange-dark)',
                          }}>
                            {sold ? `Sold${u.invoice_items[0]?.invoices?.customer_name ? ` — ${u.invoice_items[0].invoices.customer_name}` : ''}` : 'In stock'}
                          </span>
                          <button onClick={() => setEditingUnit(u)} style={{ background: 'none', border: 'none', color: 'var(--orange)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                            Edit
                          </button>
                          {!sold && (
                            <button onClick={() => deleteUnit(u, sold)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {editingUnit && (
        <EditDeviceUnitModal
          unit={editingUnit}
          suppliers={suppliers}
          onClose={() => setEditingUnit(null)}
          onSaved={() => { setEditingUnit(null); loadUnitsForProduct(selectedProductId); }}
        />
      )}

      {showImport && (
        <ImportModal
          title="Import device units"
          table="device_units"
          business={{ id: business.id }}
          supabase={supabase}
          onClose={() => setShowImport(false)}
          onImported={() => { if (selectedProductId) loadUnitsForProduct(selectedProductId); }}
          columns={[
            {
              key: 'product', dbField: 'product_id', required: true, example: 'iPhone 13 Pro',
              // Resolves a typed product NAME to its real id, using the
              // serialized-products list already loaded on this page —
              // matched case-insensitively so "iphone 13 pro" still
              // finds "iPhone 13 Pro". Only products with "Track
              // individual units" turned on in Inventory can match at
              // all, same as the manual add-units form above. A name
              // that doesn't match anything resolves to null, which
              // fails at the actual insert (a real database error,
              // not a friendly one) — the product column must match an
              // existing serialized product's name exactly.
              transform: (v) => {
                const match = products.find((p) => normalizeForMatch(p.name) === normalizeForMatch(v));
                if (!match) {
                  // Diagnostic only — safe to leave in permanently, it
                  // never affects the import itself. If this still
                  // shows up after the whitespace-normalizing fix
                  // above, the logged values show exactly what's
                  // actually being compared, rather than guessing again.
                  console.warn('Device import: no product matched', { csvValue: v, normalized: normalizeForMatch(v), availableProducts: products.map((p) => ({ name: p.name, normalized: normalizeForMatch(p.name) })) });
                }
                return match ? match.id : null;
              },
            },
            {
              key: 'supplier', dbField: 'supplier_id', example: 'Alaba Electronics Ltd',
              // Same name-to-id resolution as product, but optional —
              // a blank or unmatched supplier name just leaves this
              // unit with no supplier recorded, same as leaving the
              // supplier dropdown on "No supplier recorded" in the
              // manual form.
              transform: (v) => {
                if (!String(v).trim()) return null;
                const match = suppliers.find((s) => normalizeForMatch(s.name) === normalizeForMatch(v));
                return match ? match.id : null;
              },
            },
            { key: 'serial_number', required: true, example: 'F2LN3K9QPJ8X' },
            { key: 'imei1', example: '356938035643809', transform: (v) => (String(v).trim() ? String(v).trim() : null) },
            { key: 'imei2', example: '356938035643817', transform: (v) => (String(v).trim() ? String(v).trim() : null) },
            { key: 'color', example: 'Sierra Blue', transform: (v) => (String(v).trim() ? String(v).trim() : null) },
            { key: 'condition', example: 'new', transform: (v) => (String(v).trim() ? String(v).trim() : null) },
            { key: 'specs', example: '256GB', transform: (v) => (String(v).trim() ? String(v).trim() : null) },
            { key: 'cost_price', example: '450000', transform: (v) => (String(v).trim() === '' ? null : Number(v)) },
          ]}
        />
      )}
    </div>
    </DashboardShell>
  );
}
