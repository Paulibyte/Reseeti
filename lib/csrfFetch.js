'use client';

// Wraps fetch for this app's own mutating API routes (POST/PATCH/DELETE
// to /api/**) — reads the CSRF cookie (set by GET /api/csrf, see
// RegisterSW.jsx) and attaches it as a header, matching what
// lib/csrf.js's verifyCsrfToken checks server-side. Plain fetch still
// works everywhere else (GETs, and any call to Supabase's own REST API
// via the supabase-js client, which authenticates with a Bearer token
// instead and doesn't need this).
export async function csrfFetch(url, options = {}) {
  const match = document.cookie.match(/(?:^|;\s*)reseeti_csrf=([^;]+)/);
  const token = match?.[1];

  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { 'x-csrf-token': token } : {}),
    },
  });
}
