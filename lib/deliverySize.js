// How heavy and how bulky ONE unit of a product is, so a marketplace can work out a delivery fee (Bulktins, from upgrade 010 there).
// Both are optional. A blank means "not known" and is never turned into a number: the delivery fee asks the shop instead of guessing.
export const MAX_WEIGHT_KG = 100000;
export const MAX_VOLUME_L = 1000000;

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Checks what the owner typed. Returns { ok:true, value:{ weight_kg, volume_l } } (null for a blank) or { ok:false, error }.
export function validateDeliverySize({ weight, volume } = {}) {
  const one = (raw, max, label) => {
    if (blank(raw)) return { ok: true, value: null };
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || n < 0 || n > max) return { ok: false, error: `${label} must be a number from 0 to ${max.toLocaleString('en')}, or left blank.` };
    return { ok: true, value: Math.round(n * 1000) / 1000 };
  };
  const w = one(weight, MAX_WEIGHT_KG, 'Weight');
  if (!w.ok) return w;
  const v = one(volume, MAX_VOLUME_L, 'Size');
  if (!v.ok) return v;
  return { ok: true, value: { weight_kg: w.value, volume_l: v.value } };
}

// A suggestion from the product's own size ("50" "kg", "750" "ml"), shown as a one-click button, never saved on its own. Only a
// unit that really is a weight or a volume gives one.
const WEIGHT_UNITS = { kg: 1, g: 0.001 };
const VOLUME_UNITS = { l: 1, ltr: 1, litre: 1, litres: 1, liter: 1, liters: 1, ml: 0.001, cl: 0.01 };
export function suggestFromUnit(unit, unitValue) {
  const u = String(unit || '').trim().toLowerCase();
  const n = Number(unitValue);
  if (!u || !Number.isFinite(n) || n <= 0) return null;
  const round = (x) => Math.round(x * 1000) / 1000;
  if (u in WEIGHT_UNITS) return { field: 'weight_kg', value: round(n * WEIGHT_UNITS[u]) };
  if (u in VOLUME_UNITS) return { field: 'volume_l', value: round(n * VOLUME_UNITS[u]) };
  return null;
}

// What the public catalogue sends for a product: both keys, null when not known.
export function deliverySizeFields(p) {
  const clean = (v, max) => {
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 1000) / 1000 : null;
  };
  return { weight_kg: clean(p && p.weight_kg, MAX_WEIGHT_KG), volume_l: clean(p && p.volume_l, MAX_VOLUME_L) };
}
