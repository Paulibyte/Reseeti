// Wholesale selling: a minimum order quantity and quantity price tiers ("buy 10 bags or more and each costs less").
// ONE set of rules, used by the inventory form (to check what a shop owner enters), the shop page (what a customer sees and
// what their cart adds up to), and both order routes (the server, which is the authority on price). Because they all call
// the same functions, what the customer sees, what they are charged and what the order records can never disagree.
//
//   sale_mode  'retail'    one price, any quantity, no minimum; tiers and minimum are ignored
//              'wholesale' the minimum order quantity (moq) applies, and so do the tiers
//              'both'      anyone can buy one at the normal price, and larger quantities earn the tier price (no minimum)
//   moq        the smallest quantity that can be ordered (wholesale only)
//   price_tiers  [{ min_qty, price }]: from min_qty units, each unit costs `price` (at most 4, each cheaper than the last)

export const SALE_MODES = ['retail', 'wholesale', 'both'];
export const MAX_TIERS = 4;
// The order routes ignore any quantity above 1,000, so a minimum or a bulk-price quantity can never be set higher, otherwise a
// product could be listed that nobody is able to order.
export const MAX_MOQ = 1000;

export const SALE_MODE_LABELS = {
  retail: 'Retail only (one price)',
  wholesale: 'Wholesale only (minimum order)',
  both: 'Retail and wholesale (cheaper in bulk)',
};

const money = (n) => Math.round(Number(n) * 100) / 100;
const whole = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? n : NaN; };

export function cleanSaleMode(v) {
  return SALE_MODES.includes(v) ? v : 'retail';
}

// The smallest quantity a customer may order. Only a wholesale product has a minimum.
export function minOrderQty(product) {
  if (!product || product.sale_mode !== 'wholesale') return 1;
  const n = whole(product.moq);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_MOQ) : 1;
}

// The tiers of a product as they will be USED: tidy, in order, each from a higher quantity and at a lower price than
// the one before. Anything that does not fit is dropped rather than guessed at. Retail products have none.
export function tiersOf(product) {
  if (!product || !(product.sale_mode === 'wholesale' || product.sale_mode === 'both') || !Array.isArray(product.price_tiers)) return [];
  const base = Number(product.price);
  const seen = new Set();
  const candidates = [];
  for (const t of product.price_tiers) {
    const q = whole(t && t.min_qty);
    const p = Number(t && t.price);
    if (!Number.isFinite(q) || q < 2 || q > MAX_MOQ || !Number.isFinite(p) || p <= 0 || seen.has(q)) continue;
    seen.add(q);
    candidates.push({ min_qty: q, price: money(p) });
  }
  candidates.sort((a, b) => a.min_qty - b.min_qty);
  const out = [];
  let floor = Number.isFinite(base) ? base : Infinity;
  for (const t of candidates) {
    if (t.price < floor) { out.push(t); floor = t.price; } // a "discount" that is not cheaper is not a discount
    if (out.length === MAX_TIERS) break;
  }
  return out;
}

// What ONE unit costs when buying `qty` units.
export function unitPriceFor(product, qty) {
  const q = Number(qty);
  let price = Number(product && product.price);
  for (const t of tiersOf(product)) if (q >= t.min_qty) price = t.price;
  return money(price);
}

// What `qty` units cost in total.
export function lineTotal(product, qty) {
  return money(unitPriceFor(product, qty) * Number(qty));
}

// The lowest price a unit can ever cost (for "from ₦X").
export function lowestUnitPrice(product) {
  const tiers = tiersOf(product);
  return tiers.length ? tiers[tiers.length - 1].price : money(product && product.price);
}

// Is this product sold in bulk at all (so the shop should talk about packs, minimums and tiers)?
export function isBulk(product) {
  return !!product && (product.sale_mode === 'wholesale' || product.sale_mode === 'both');
}

// The wholesale fields of a product, tidy, for sending to a shop page or another site.
export function wholesaleFields(product) {
  const mode = cleanSaleMode(product && product.sale_mode);
  const fields = { sale_mode: mode, moq: minOrderQty({ sale_mode: mode, moq: product && product.moq }), price_tiers: tiersOf({ ...product, sale_mode: mode }) };
  const when = product && product.price_updated_at ? new Date(product.price_updated_at) : null;
  fields.price_updated_at = when && !Number.isNaN(when.getTime()) ? when.toISOString() : null;
  return fields;
}

// Checks what a shop owner typed in the form. Returns { ok: true, value } with tidy values to save, or { ok: false, error }
// with a plain sentence for the person. `price` is the normal price they are also entering.
export function validateWholesale({ saleMode, moq, tiers, price }) {
  const mode = cleanSaleMode(saleMode);
  if (mode === 'retail') return { ok: true, value: { sale_mode: 'retail', moq: 1, price_tiers: [] }, warnings: [] };

  const base = Number(price);
  if (!Number.isFinite(base) || base <= 0) return { ok: false, error: 'Enter the normal price first, then the bulk prices.' };

  let minimum = 1;
  if (mode === 'wholesale') {
    const m = whole(moq === '' || moq == null ? 1 : moq);
    if (!Number.isFinite(m) || m < 1 || m > MAX_MOQ) return { ok: false, error: `The minimum order must be a whole number from 1 to ${MAX_MOQ.toLocaleString('en-NG')}.` };
    minimum = m;
  }

  const rows = (Array.isArray(tiers) ? tiers : []).filter((t) => t && (String(t.min_qty ?? '').trim() !== '' || String(t.price ?? '').trim() !== ''));
  if (rows.length > MAX_TIERS) return { ok: false, error: `Up to ${MAX_TIERS} bulk prices.` };
  const clean = [];
  const warnings = [];
  let lastQty = Math.max(minimum, 1);
  let lastPrice = base;
  for (let i = 0; i < rows.length; i += 1) {
    const q = whole(rows[i].min_qty);
    const p = Number(rows[i].price);
    const n = i + 1;
    if (!Number.isFinite(q) || String(rows[i].min_qty).trim() === '') return { ok: false, error: `Bulk price ${n}: enter the quantity it starts from.` };
    if (!Number.isFinite(p) || p <= 0) return { ok: false, error: `Bulk price ${n}: enter a price above zero.` };
    if (q <= lastQty) return { ok: false, error: `Bulk price ${n}: the quantity must be more than ${lastQty}${i === 0 && mode === 'wholesale' ? ' (your minimum order)' : i === 0 ? '' : ' (the one before it)'}.` };
    if (q > MAX_MOQ) return { ok: false, error: `Bulk price ${n}: the quantity is too large.` };
    if (money(p) >= lastPrice) return { ok: false, error: `Bulk price ${n}: it must be lower than ${i === 0 ? 'the normal price' : 'the one before it'} (₦${lastPrice.toLocaleString('en-NG')}).` };
    // The whole order moves to the cheaper price, so just past a tier the total can be LESS than just before it
    // (for example 10 bags cost less than 9). That is how bulk prices normally work, but it is easy to set by accident with
    // a big discount, so the owner is told what it means before saving. It is a note, not a refusal.
    const justBefore = money((i === 0 ? base : lastPrice) * (q - 1));
    const atTier = money(money(p) * q);
    if (atTier < justBefore) warnings.push(`Ordering ${q} will cost less than ordering ${q - 1} (₦${atTier.toLocaleString('en-NG')} against ₦${justBefore.toLocaleString('en-NG')}). That is normal for bulk prices, but check it is what you want.`);
    clean.push({ min_qty: q, price: money(p) });
    lastQty = q; lastPrice = money(p);
  }
  return { ok: true, value: { sale_mode: mode, moq: minimum, price_tiers: clean }, warnings };
}

// A short line for a shop card: "10+ bags: ₦9,500 each" style text is built by the caller with its own money format.
export function tierSentence(tier, format, unitWord = '') {
  return `${tier.min_qty}+${unitWord ? ` ${unitWord}` : ''}: ${format(tier.price)} each`;
}
