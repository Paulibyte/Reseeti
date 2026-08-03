'use client';

import { useRef, useState } from 'react';

// The overwhelming majority of cheap barcode/QR scanner hardware (USB or
// Bluetooth) needs zero special code at all — it emulates a keyboard,
// "typing" the scanned code followed by Enter into whatever text input
// currently has focus. This component is really just a text input with
// two conveniences layered on for that use case: auto-focus so the
// scanner's keystrokes land somewhere useful without a manual click
// first, and clearing itself after each Enter so the next scan doesn't
// need the field cleared by hand first.
//
// A human typing a barcode by hand also works fine through the exact
// same input — this isn't scanner-only, it's just tuned for it.
export default function BarcodeScanInput({ onScan, placeholder = 'Scan or type a barcode, then Enter', autoFocus = true, style }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  function handleKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = value.trim();
    if (!code) return;
    onScan(code);
    setValue('');
  }

  return (
    <input
      ref={inputRef}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      style={{
        width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6,
        fontSize: 14, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'monospace',
        ...style,
      }}
    />
  );
}
