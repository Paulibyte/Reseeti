// One shared implementation for all three providers rather than three
// near-identical files — Google, Dropbox, and Microsoft all implement
// standard OAuth2 authorization-code + refresh-token grants, so the
// auth/token-exchange/refresh logic below is genuinely generic. Only the
// upload call itself (uploadBackupFile) differs per provider, since each
// has its own file-upload API shape.
//
// SERVER-ONLY — client IDs are fine to expose, but client secrets and
// every token this file handles are not. Only ever imported from
// app/api/backup/**/route.js.

export const PROVIDERS = {
  google: {
    label: 'Google Drive',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/drive.file',
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    // access_type=offline + prompt=consent is what makes Google actually
    // hand back a refresh_token — without both, a second authorization
    // from the same Google account silently omits it, since Google only
    // issues one the very first time an app is authorized.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  dropbox: {
    label: 'Dropbox',
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scope: 'files.content.write',
    clientId: process.env.DROPBOX_CLIENT_ID,
    clientSecret: process.env.DROPBOX_CLIENT_SECRET,
    // token_access_type=offline is Dropbox's equivalent of Google's
    // access_type=offline — without it, Dropbox issues a short-lived
    // access token only, no refresh_token at all.
    extraAuthParams: { token_access_type: 'offline' },
  },
  onedrive: {
    label: 'OneDrive',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    // offline_access is what earns a refresh_token from Microsoft's v2
    // endpoint; Files.ReadWrite is scoped to app-created files/folders
    // only would be nicer (Files.ReadWrite.AppFolder) but that scope
    // restricts uploads to a hidden Apps folder most people never look
    // in — Files.ReadWrite keeps the backup somewhere the business owner
    // will actually find it, matching Drive/Dropbox's behavior below.
    scope: 'Files.ReadWrite offline_access',
    clientId: process.env.ONEDRIVE_CLIENT_ID,
    clientSecret: process.env.ONEDRIVE_CLIENT_SECRET,
    extraAuthParams: {},
  },
};

export function isProviderConfigured(provider) {
  const cfg = PROVIDERS[provider];
  return !!(cfg && cfg.clientId && cfg.clientSecret);
}

export function buildAuthUrl(provider, redirectUri, state) {
  const cfg = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scope,
    state,
    ...cfg.extraAuthParams,
  });
  return `${cfg.authUrl}?${params.toString()}`;
}

// Standard OAuth2 authorization_code grant — identical shape across all
// three providers.
export async function exchangeCodeForTokens(provider, code, redirectUri) {
  const cfg = PROVIDERS[provider];
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `${cfg.label} token exchange failed`);
  // expires_in is seconds-from-now on every provider here; converted to
  // an absolute timestamp immediately so nothing downstream has to know
  // when the token was actually issued.
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

// Standard OAuth2 refresh_token grant — also identical across all three.
export async function refreshAccessToken(provider, refreshToken) {
  const cfg = PROVIDERS[provider];
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || `${cfg.label} token refresh failed`);
  return {
    accessToken: data.access_token,
    // Dropbox/Google/Microsoft all only rotate the refresh_token
    // occasionally (or never, for long-lived ones) — fall back to
    // reusing the existing one when the response doesn't include a new
    // one, rather than treating a missing field as "the refresh token is
    // now gone."
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  };
}

// The one genuinely provider-specific piece. filename should already be
// a full, safe, extension-included name (e.g.
// "Reseeti Backup - Ada's Store - 2026-07-16.json") — each branch below
// just decides where under the account it lands.
export async function uploadBackupFile(provider, accessToken, filename, jsonContent) {
  if (provider === 'google') {
    return uploadToGoogleDrive(accessToken, filename, jsonContent);
  }
  if (provider === 'dropbox') {
    return uploadToDropbox(accessToken, filename, jsonContent);
  }
  if (provider === 'onedrive') {
    return uploadToOneDrive(accessToken, filename, jsonContent);
  }
  throw new Error(`Unknown backup provider: ${provider}`);
}

// Multipart "simple upload" — appropriate for files under 5MB, which a
// JSON export of a small business's data comfortably is (see
// lib/backupExport.js). A resumable upload session would be needed for
// larger files, not attempted here.
async function uploadToGoogleDrive(accessToken, filename, jsonContent) {
  const boundary = 'reseeti-backup-boundary';
  const metadata = JSON.stringify({ name: filename, mimeType: 'application/json' });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${jsonContent}\r\n` +
    `--${boundary}--`;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Google Drive upload failed');
  return data;
}

async function uploadToDropbox(accessToken, filename, jsonContent) {
  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: `/Reseeti Backups/${filename}`,
        mode: 'overwrite',
        autorename: false,
        mute: true,
      }),
    },
    body: jsonContent,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_summary || 'Dropbox upload failed');
  return data;
}

async function uploadToOneDrive(accessToken, filename, jsonContent) {
  const path = encodeURIComponent(`/Reseeti Backups/${filename}`).replace(/%2F/g, '/');
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${path}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: jsonContent,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'OneDrive upload failed');
  return data;
}
