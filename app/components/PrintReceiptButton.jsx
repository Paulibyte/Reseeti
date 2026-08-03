'use client';

import { useState, useEffect } from 'react';
import { buildReceiptBytes } from '../../lib/printing/escpos';
import { isBluetoothPrintingSupported, isSerialPrintingSupported, printViaBluetooth, printViaSerial } from '../../lib/printing/thermalPrint';

// Used on the receipt page (app/inv/[id]/ReceiptClient.jsx) alongside
// the existing Download PDF / Share buttons. Offers whichever printing
// paths this browser actually supports — on an iPhone that's neither, so
// this renders nothing at all there rather than two buttons that would
// only ever throw an unsupported-browser error.
//
// IMPORTANT: the bluetoothOk/serialOk capability check reads
// navigator.bluetooth / navigator.serial, which don't exist during
// server rendering. Calling isBluetoothPrintingSupported() etc. directly
// in the render body meant the server always rendered null (no
// `navigator`), while a client that *does* support these APIs rendered a
// real button on its very first paint — a mismatch React's hydration
// catches and throws on. Deferring the check to useEffect means the
// first client render always matches the server (both show nothing),
// and the real button appears a beat later, after hydration is done —
// which is invisible in practice since it happens within milliseconds.
export default function PrintReceiptButton({ business, invoice, items }) {
  const [open, setOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [capabilities, setCapabilities] = useState({ bluetoothOk: false, serialOk: false, checked: false });

  useEffect(() => {
    setCapabilities({
      bluetoothOk: isBluetoothPrintingSupported(),
      serialOk: isSerialPrintingSupported(),
      checked: true,
    });
  }, []);

  const { bluetoothOk, serialOk, checked } = capabilities;

  // Before the effect has run (server render, and the first client
  // render) — render nothing, matching on both sides. Once checked,
  // render nothing anyway if neither transport is supported.
  if (!checked || (!bluetoothOk && !serialOk)) return null;

  async function handlePrint(transport) {
    setPrinting(true);
    setError('');
    try {
      const bytes = buildReceiptBytes({ business, invoice, items });
      if (transport === 'bluetooth') await printViaBluetooth(bytes);
      else await printViaSerial(bytes);
      setOpen(false);
    } catch (err) {
      // A cancelled device picker throws too (the person just changed
      // their mind) — worth not treating that identically to a real
      // connection failure in the message shown.
      setError(err.message?.includes('cancelled') || err.name === 'NotFoundError'
        ? 'No printer selected.'
        : err.message);
    }
    setPrinting(false);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8,
          padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}
      >
        🖨️ Print receipt
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 30, minWidth: 220,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: 'var(--shadow)', padding: 8,
          }}
        >
          {bluetoothOk && (
            <button onClick={() => handlePrint('bluetooth')} disabled={printing} style={optionStyle}>
              🔵 Bluetooth thermal printer
            </button>
          )}
          {serialOk && (
            <button onClick={() => handlePrint('serial')} disabled={printing} style={optionStyle}>
              🔌 USB thermal printer
            </button>
          )}
          {printing && <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '4px 8px 2px' }}>Connecting to printer…</p>}
          {error && <p style={{ fontSize: 11.5, color: 'var(--danger)', margin: '4px 8px 2px' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}

const optionStyle = {
  display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
  padding: '8px 8px', fontSize: 13, color: 'var(--text)', cursor: 'pointer', borderRadius: 6,
};