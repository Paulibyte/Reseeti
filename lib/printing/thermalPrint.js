'use client';

// Both APIs here are Chrome/Edge-only (desktop and Android) — neither
// Web Bluetooth nor Web Serial is implemented in Safari or Firefox as of
// this writing, which matters a lot for a Nigerian small-business
// audience where iPhones are common. Every export below feature-detects
// and throws a clear error rather than failing silently or crashing;
// callers (app/components/PrintReceiptButton.jsx) are expected to check
// isBluetoothPrintingSupported()/isSerialPrintingSupported() before
// showing each option at all.

export function isBluetoothPrintingSupported() {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export function isSerialPrintingSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

// Many generic/no-name ESC/POS Bluetooth thermal printers (the kind
// widely resold under dozens of different brand names across Nigerian
// online marketplaces) share this exact GATT service/characteristic pair
// — it comes from a common reference chipset, not a real standard, so
// it's a "usually works," not a guarantee. If a specific printer doesn't
// connect, its manual/spec sheet is the place to find its actual UUIDs.
const GENERIC_PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const GENERIC_PRINTER_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

// Bluetooth GATT writes are chunked — most of these printers' write
// characteristic rejects anything past a couple hundred bytes in one
// packet, so a full receipt (easily 500+ bytes) has to go out in pieces.
const BLE_CHUNK_SIZE = 180;

export async function printViaBluetooth(bytes) {
  if (!isBluetoothPrintingSupported()) {
    throw new Error('This browser doesn\'t support Bluetooth printing — try Chrome or Edge on Android or desktop.');
  }

  // requestDevice() only ever works from a real user gesture (a click),
  // and always shows the browser's own device picker — there's no way to
  // silently reconnect to a specific printer without that picker (Web
  // Bluetooth doesn't have a getDevices()-and-skip-the-prompt path the
  // way Web Serial does below).
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [GENERIC_PRINTER_SERVICE_UUID] }],
    optionalServices: [GENERIC_PRINTER_SERVICE_UUID],
  });

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(GENERIC_PRINTER_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(GENERIC_PRINTER_CHARACTERISTIC_UUID);

  for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK_SIZE) {
    const chunk = bytes.slice(offset, offset + BLE_CHUNK_SIZE);
    await characteristic.writeValue(chunk);
  }

  server.disconnect();
}

// USB thermal/receipt printers that expose a serial (CDC) interface —
// common on cheaper USB models — show up to the browser as a serial
// port, not a distinct "printer" device type, which is what Web Serial
// (rather than the lower-level, vendor-ID-matching Web USB API) is built
// around. A printer that instead exposes a raw USB printer-class
// interface with no serial layer won't show up here — see
// README_STAGE24.md.
export async function printViaSerial(bytes) {
  if (!isSerialPrintingSupported()) {
    throw new Error('This browser doesn\'t support USB serial printing — try Chrome or Edge on desktop.');
  }

  const port = await navigator.serial.requestPort();
  // 9600 baud is the most common default on these printers; several
  // support higher rates too, but 9600 is the safest first guess and
  // matches most manufacturers' out-of-box setting.
  await port.open({ baudRate: 9600 });

  const writer = port.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
    await port.close();
  }
}
