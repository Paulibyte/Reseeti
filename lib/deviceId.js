'use client';

// A random id the browser generates for itself once and keeps in
// localStorage — not a hardware fingerprint, just a stable
// per-browser-profile identifier so the app can tell "this is a device
// we've seen sign in before" from "this is new." Clearing browser data
// (or using a different browser/profile) naturally creates a new device
// id, which is the expected/correct behavior: from this app's
// perspective that really is a different "device" showing up.
const DEVICE_ID_KEY = 'reseeti_device_id';

export function getDeviceId() {
  if (typeof window === 'undefined') return null;
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// A short, human-readable guess at what this device is, shown in the
// Security page's device list — "Chrome on Android," not a raw user
// agent string. Deliberately rough; it only needs to be recognizable,
// not precise.
export function guessDeviceLabel() {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
