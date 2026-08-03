// The single source of truth for displaying money in this app. Before
// this, seven different files each had their own local money() function —
// most matched, but ReceiptClient.jsx's didn't pass maximumFractionDigits,
// so a value with floating-point noise (e.g. 1250.0000000001 from
// qty × price arithmetic) could render as "₦1,250" on some pages and
// "₦1,250.000000001" on the receipt. One function, one behavior,
// everywhere.
export function formatNaira(amount) {
  return '₦' + Number(amount || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

// Percentage display for rates stored as e.g. 7.5 — used on invoice
// breakdowns and settings ("VAT (7.5%)").
export function formatRate(rate) {
  const n = Number(rate || 0);
  return (Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '%';
}
