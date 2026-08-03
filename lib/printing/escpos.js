// ESC/POS is the command language nearly every thermal receipt printer
// speaks, regardless of brand — this builds the raw byte sequence for a
// compact receipt from an invoice object, used by both the Bluetooth and
// USB/Serial transports (lib/printing/thermalPrint.js), which only
// differ in how the bytes physically get to the printer, not in what the
// bytes say. Pure JS, no printer SDK/dependency — just documented
// command bytes, in wide use since 1990s Epson TM printers and still the
// de facto standard on cheap generic printers today.

const ESC = 0x1b;
const GS = 0x1d;

function textToBytes(str) {
  // Plain ASCII/Latin-1 — most cheap thermal printers' default code page
  // doesn't reliably render the Naira sign (₦) or other non-ASCII
  // characters, so it's spelled out as "NGN" in the receipt builder
  // below rather than risk printing garbled bytes on unsupported
  // hardware.
  return Array.from(str, (c) => c.charCodeAt(0) & 0xff);
}

function line(str = '') {
  return [...textToBytes(str), 0x0a]; // \n
}

function centered(bytes) {
  return [ESC, 0x61, 0x01, ...bytes, ESC, 0x61, 0x00]; // ESC a 1 = center, ESC a 0 = left (restore)
}

function bold(bytes) {
  return [ESC, 0x45, 0x01, ...bytes, ESC, 0x45, 0x00]; // ESC E 1 = bold on, ESC E 0 = bold off
}

function doubleWidth(bytes) {
  return [GS, 0x21, 0x11, ...bytes, GS, 0x21, 0x00]; // GS ! 0x11 = double width+height, GS ! 0 = restore
}

// Right-pads/truncates two columns to fit the printer's character width
// (32 chars is the standard width for the common 58mm paper size most of
// these cheap printers use; 80mm printers fit more, but 32 is the safe
// default that won't wrap awkwardly on the smaller, far more common
// size).
function twoColumn(left, right, width = 32) {
  const space = Math.max(1, width - left.length - right.length);
  return `${left}${' '.repeat(space)}${right}`;
}

export function buildReceiptBytes({ business, invoice, items }) {
  const bytes = [];
  bytes.push(ESC, 0x40); // ESC @ — initialize/reset printer state

  bytes.push(...centered(bold(doubleWidth(textToBytes(business.name || 'Receipt')))));
  bytes.push(0x0a);
  if (business.phone) bytes.push(...centered(line(business.phone)));
  if (business.address) bytes.push(...centered(line(business.address)));
  bytes.push(...line('-'.repeat(32)));

  bytes.push(...line(`Invoice: ${invoice.invoice_number}`));
  bytes.push(...line(`Date: ${new Date(invoice.created_at).toLocaleDateString('en-NG')}`));
  if (invoice.customer_name) bytes.push(...line(`Customer: ${invoice.customer_name}`));
  bytes.push(...line('-'.repeat(32)));

  (items || []).forEach((it) => {
    bytes.push(...line(it.description));
    const qtyPrice = `${it.qty} x ${Number(it.price).toLocaleString('en-NG')}`;
    const lineTotal = Number(it.qty * it.price).toLocaleString('en-NG');
    bytes.push(...line(twoColumn(qtyPrice, lineTotal)));
  });

  bytes.push(...line('-'.repeat(32)));
  bytes.push(...bold(line(twoColumn('TOTAL', `NGN ${Number(invoice.total).toLocaleString('en-NG')}`))));
  bytes.push(...line(invoice.paid ? 'PAID' : 'UNPAID'));
  bytes.push(0x0a);
  bytes.push(...centered(line('Thank you for your business!')));
  bytes.push(0x0a, 0x0a, 0x0a);

  bytes.push(GS, 0x56, 0x42, 0x00); // GS V B 0 — partial paper cut, common across most models

  return new Uint8Array(bytes);
}
