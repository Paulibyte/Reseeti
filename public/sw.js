// Deliberately simple, hand-written service worker — no Workbox, no
// build-time precache manifest. Next.js hashes its JS bundle filenames on
// every build, which makes a static precache list go stale fast; a
// runtime cache-as-you-go strategy avoids that maintenance problem
// entirely at the cost of the very first visit needing a connection.

// Bumped for Stage 20 — install no longer auto-activates (see below), so
// old clients need the new worker's lifecycle to take over.
const CACHE_NAME = 'reseeti-shell-v3';

// Runtime cache is capped at this many entries. Without a limit, a
// business that browses a lot of invoices/receipts over months would
// slowly accumulate an unbounded cache — this is what "automatic cache
// cleanup" means here: not just wiping old *versions* of the cache (the
// activate handler below already did that), but keeping the *current*
// cache itself from growing forever.
const MAX_CACHE_ENTRIES = 200;

self.addEventListener('install', (event) => {
  // No self.skipWaiting() here — that's the whole point of Stage 20's
  // update flow. A newly-installed worker now waits until the person
  // actually agrees to update (UpdateNotification.jsx's "Refresh" button,
  // via lib/pwa.js's applyUpdate()) before it takes over. Auto-activating
  // mid-session used to mean the app could silently switch to new code
  // while someone was partway through creating an invoice.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// The person's "Refresh" click (via lib/pwa.js's applyUpdate) lands here —
// this is what finally lets a waiting worker become active.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Deletes the oldest entries (by insertion order — Cache.keys() returns
// entries in the order they were added, which is a reasonable enough
// proxy for "oldest" without the complexity of tracking real timestamps)
// once the cache passes MAX_CACHE_ENTRIES. Called after every successful
// cache.put() rather than on a timer, so the cache never actually
// exceeds the cap even briefly.
async function trimCache(cache) {
  const keys = await cache.keys();
  const overBy = keys.length - MAX_CACHE_ENTRIES;
  if (overBy <= 0) return;
  await Promise.all(keys.slice(0, overBy).map((key) => cache.delete(key)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  // Never cache the data plane: Supabase's REST/Auth/Realtime endpoints
  // must always hit the network (or fail loudly), since they're the
  // source of truth and caching them would show stale invoice/customer
  // data as if it were current.
  //
  // Supabase Storage is different — business logos and signatures are
  // immutable-by-URL (a new upload gets a new path) static assets, not
  // data, so they're safe and worth caching for instant repeat paints
  // and offline viewing. This is the one behavior change from v1: v1
  // excluded every *.supabase.co request, which meant a business's own
  // logo was re-downloaded from the network on every single page load.
  const isSupabaseData = url.includes('supabase.co') && !url.includes('/storage/v1/object/public/');
  if (request.method !== 'GET' || url.includes('/api/') || isSupabaseData) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const fresh = await fetch(request);
        // Cache successful responses from our own origin, plus the public
        // Supabase Storage bucket carved out above.
        if (fresh.ok && (url.startsWith(self.location.origin) || url.includes('/storage/v1/object/public/'))) {
          await cache.put(request, fresh.clone());
          trimCache(cache);
        }
        return fresh;
      } catch (err) {
        // Offline (or the request failed) — fall back to whatever we
        // last cached for this exact URL, if anything.
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
      }
    })
  );
});

// Background Sync: fired by the browser once connectivity returns, even
// if no tab is in the foreground (see lib/offlineQueue.js for the
// registration side). The worker itself doesn't have the signed-in
// user's Supabase session, so it can't push the queued invoices to the
// database directly — instead it asks every open client to do it, since
// those tabs already hold the session in memory/localStorage.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'reseeti-sync-invoices') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'RESEETI_SYNC_REQUESTED' }));
    })
  );
});
