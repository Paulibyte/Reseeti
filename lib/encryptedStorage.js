'use client';

// Encrypts sensitive values before they're written to localStorage —
// used by lib/offlineQueue.js for queued invoice drafts (customer names,
// phone numbers, amounts), which previously sat there in plain text.
//
// Threat model, stated plainly: this does NOT protect against
// same-origin JavaScript reading the data (a real XSS vulnerability in
// this app would defeat it completely, since malicious same-origin code
// can just ask the browser to decrypt using the same key this code
// uses). What it DOES protect against is anything that can read the
// browser's storage files directly without running JS in this origin —
// another local application with disk access, a browser extension with
// broad storage permissions, forensic recovery of an unencrypted
// SQLite/LevelDB file, or someone with physical access to the device
// opening the profile folder. That's a real, meaningful threat model for
// a shared or borrowed device, which is common for small-business staff
// in Nigeria using a shared shop computer or a borrowed phone.
//
// The key itself is a non-extractable AES-GCM CryptoKey generated once
// per browser profile and stored in IndexedDB as a real CryptoKey object
// (not raw key bytes) — the Web Crypto API supports storing
// non-extractable keys directly via structured clone, meaning the key
// material itself is never exposed as a byte string this code could
// accidentally log, transmit, or otherwise leak. It never leaves the
// device and isn't derived from anything server-side, which is also why
// this can't help across devices — encrypted data written on one device
// isn't decryptable on another, which is fine for its one actual use
// case (the offline draft queue, which is inherently per-device already).

const DB_NAME = 'reseeti-keystore';
const STORE_NAME = 'keys';
const KEY_ID = 'device-key';

function openKeyDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getOrCreateDeviceKey() {
  const db = await openKeyDB();

  const existing = await new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(KEY_ID);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
  if (existing) return existing;

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return key;
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Returns a single string safe to store as one localStorage value.
export async function encryptForStorage(plainObject) {
  const key = await getOrCreateDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(plainObject));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return `${toBase64(iv)}.${toBase64(ciphertext)}`;
}

export async function decryptFromStorage(stored) {
  const [ivB64, ciphertextB64] = stored.split('.');
  if (!ivB64 || !ciphertextB64) throw new Error('Malformed encrypted storage value');
  const key = await getOrCreateDeviceKey();
  const iv = fromBase64(ivB64);
  const ciphertext = fromBase64(ciphertextB64);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function isEncryptedStorageSupported() {
  return typeof window !== 'undefined' && !!window.crypto?.subtle && typeof indexedDB !== 'undefined';
}
