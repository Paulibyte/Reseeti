'use client';

import { useState } from 'react';
import { createClient } from '../../../lib/supabaseClient';

const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 10, boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)' };
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 };

export default function EditDeviceUnitModal({ unit, suppliers, onClose, onSaved }) {
  const supabase = createClient();
  const [form, setForm] = useState({
    serial_number: unit.serial_number || '',
    imei1: unit.imei1 || '',
    imei2: unit.imei2 || '',
    color: unit.color || '',
    condition: unit.condition || 'new',
    specs: unit.specs || '',
    cost_price: unit.cost_price == null ? '' : String(unit.cost_price),
    supplier_id: unit.supplier_id || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!form.serial_number.trim()) {
      setError('Serial number is required.');
      return;
    }
    setSaving(true);
    setError('');
    const { error: dbError } = await supabase
      .from('device_units')
      .update({
        serial_number: form.serial_number.trim(),
        imei1: form.imei1.trim() || null,
        imei2: form.imei2.trim() || null,
        color: form.color.trim() || null,
        condition: form.condition || null,
        specs: form.specs.trim() || null,
        cost_price: form.cost_price === '' ? null : Number(form.cost_price),
        supplier_id: form.supplier_id || null,
      })
      .eq('id', unit.id);
    setSaving(false);
    if (dbError) {
      // A duplicate serial number hits the unique constraint added
      // earlier — surfaced as-is here since the raw message already
      // says exactly what's wrong (this same serial exists already).
      setError(dbError.message);
      return;
    }
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 65 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 380, width: '100%', maxHeight: '90vh', overflowY: 'auto', borderTop: '5px solid var(--orange)', boxSizing: 'border-box' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>Edit unit</h3>

        <label style={labelStyle}>Serial number</label>
        <input value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} style={inputStyle} />

        <label style={labelStyle}>IMEI 1</label>
        <input value={form.imei1} onChange={(e) => set('imei1', e.target.value)} style={inputStyle} />

        <label style={labelStyle}>IMEI 2</label>
        <input value={form.imei2} onChange={(e) => set('imei2', e.target.value)} style={inputStyle} />

        <label style={labelStyle}>Color</label>
        <input value={form.color} onChange={(e) => set('color', e.target.value)} style={inputStyle} />

        <label style={labelStyle}>Condition</label>
        <select value={form.condition} onChange={(e) => set('condition', e.target.value)} style={inputStyle}>
          <option value="new">New</option>
          <option value="used">Used</option>
          <option value="refurbished">Refurbished</option>
        </select>

        <label style={labelStyle}>Specs</label>
        <input value={form.specs} onChange={(e) => set('specs', e.target.value)} style={inputStyle} placeholder="e.g. 128GB, 8GB RAM" />

        <label style={labelStyle}>Cost price</label>
        <input type="number" min="0" value={form.cost_price} onChange={(e) => set('cost_price', e.target.value)} style={inputStyle} />

        <label style={labelStyle}>Supplier</label>
        <select value={form.supplier_id} onChange={(e) => set('supplier_id', e.target.value)} style={inputStyle}>
          <option value="">No supplier recorded</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button onClick={save} disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
