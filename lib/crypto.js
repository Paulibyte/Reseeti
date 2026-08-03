// Used to encrypt cloud-backup OAuth tokens (lib/cloudBackup.js) before
// they're written to cloud_backup_connections — those tokens are
// capable of reading/writing a business owner's actual Google
// Drive/Dropbox/OneDrive, so they don't sit in the database as plain
// text. SERVER-ONLY: only ever imported from app/api/*/route.js.

import crypto from 'crypto';

// Accepts any string as ENCRYPTION_KEY (not just a properly-formatted
// 32-byte hex key) and hashes it down to exactly 32 bytes — one less way
// for setup to go wrong for someone pasting in a random password rather
// than generating a byte-exact key.
function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is not configured on the server.');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

// Output is a single base64 string: iv (12 bytes) + auth tag (16 bytes) +
// ciphertext, concatenated — self-contained, nothing else needs storing
// alongside it in the database.
export function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(payload) {
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// Used by every webhook signature check (Paystack, OPay, Monnify) and
// CSRF token verification — a plain `expected === received` string
// comparison short-circuits at the first differing character, which
// leaks (in principle; exploiting it remotely over the internet is hard,
// but not impossible) how many leading characters an attacker's guess
// got right. Same-length inputs are required going in, since
// timingSafeEqual throws on a length mismatch rather than returning
// false — this normalizes that into a plain boolean.
export function timingSafeEqualHex(expectedHex, receivedHex) {
  if (typeof receivedHex !== 'string' || typeof expectedHex !== 'string') return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(receivedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
