'use client';

import { useEffect, useRef, useState } from 'react';

// Chrome/Edge on Android and desktop only — Safari/iOS (and Firefox)
// don't implement the Barcode Detection API and have no announced plans
// to. That's a real gap for an audience where iPhones are common, which
// is exactly why this app leads with BarcodeScanInput's HID-scanner
// input as the primary path (works on every device with zero API
// dependency) and treats this camera option as a bonus for
// Android/desktop Chrome users who don't have separate scanner hardware.
export function isCameraScanningSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

// Renders a small camera preview + live-scans it. Calls onDetected(code)
// the first time a barcode/QR is found and stops itself — one scan per
// open, matching how a physical scanner is used (point, beep, done),
// rather than a continuous multi-scan session.
export default function CameraBarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let detector;
    let rafId;

    async function start() {
      if (!isCameraScanningSupported()) {
        setError('Camera scanning isn\'t supported in this browser — try a physical scanner, or type the code by hand.');
        return;
      }
      try {
        detector = new window.BarcodeDetector({
          formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'],
        });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        scanLoop();
      } catch (err) {
        setError(err.name === 'NotAllowedError' ? 'Camera access was denied.' : 'Could not open the camera.');
      }
    }

    async function scanLoop() {
      if (cancelled || !videoRef.current) return;
      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes.length > 0) {
          onDetected(barcodes[0].rawValue);
          return; // stop after the first hit — see function comment above
        }
      } catch {
        // A frame occasionally fails to decode (mid-motion blur, etc.) —
        // not worth surfacing as an error, just try the next frame.
      }
      rafId = requestAnimationFrame(scanLoop);
    }

    start();
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 16, maxWidth: 420, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--heading)', fontSize: 14.5 }}>Scan a barcode or QR code</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-faint)' }}>✕</button>
        </div>

        {error ? (
          <p style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</p>
        ) : (
          <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 8, background: '#000' }} />
        )}
      </div>
    </div>
  );
}
