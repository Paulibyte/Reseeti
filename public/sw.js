// Deliberately simple, hand-written service worker — no Workbox, no
// build-time precache manifest. Next.js hashes its JS bundle filenames on
// every build, which makes a static precache list go stale fast; a
// runtime cache-as-you-go strategy avoids that maintenance problem
// entirely at the cost of the very first visit needing a connection.

// Bumped again — this version adds proactive precaching of the app
// shell itself (see the install handler below), on top of Stage 21's
// RSC-request fix.
const CACHE_NAME = 'reseeti-shell-v5';

// The exact URL an installed PWA launches into (manifest.json's
// start_url) plus /login, precached the moment this service worker
// installs — not left to "cache as you go" from normal browsing.
// Without this, a person who always reaches /dashboard through an
// in-app client-side redirect (e.g. straight after signing in) rather
// than a genuine full page load could have NO cached copy of the real
// dashboard HTML at all, even after using the app successfully many
// times — the RSC-skip fix above is correct (an in-app navigation's
// response is the wrong thing to cache at this URL), but on its own it
// never guarantees a GOOD entry gets cached either. A cold, offline
// launch from the home-screen icon is a genuine top-level navigation,
// with nothing to fall back to if this never ran — which is exactly
// what showed up as the browser's own "site can't be reached" page
// instead of the app's offline view.
const PRECACHE_URLS = ['/dashboard', '/login'];

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
  //
  // The precache below runs regardless of that waiting behavior — it
  // just populates this worker's own cache in the background while it
  // waits, so the moment it does take over (on the person's next
  // deliberate update), a good /dashboard entry is already sitting
  // there. Each URL is fetched and cached independently (not
  // cache.addAll, which fails the whole batch if any single request
  // fails) — losing /login shouldn't cost /dashboard, or vice versa —
  // and the whole thing is best-effort: if precaching fails entirely
  // (e.g. installed while genuinely offline for the first time), the
  // worker still installs normally and falls back to the existing
  // cache-as-you-go behavior, exactly as before this existed.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          fetch(url)
            .then((res) => { if (res.ok) return cache.put(url, res); })
            .catch(() => {})
        )
      )
    )
  );
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

  // Next.js's App Router fetches two fundamentally different responses
  // from the *same URL*: a full HTML document on a real navigation (new
  // tab, refresh, a shared link — exactly what offline "open/print"
  // needs), and a separate "RSC" flight payload when the app itself
  // navigates there client-side (e.g. save()'s onSaved routing straight
  // to a freshly-synced invoice's page after Save). Both are plain GETs
  // to the identical URL, so they'd otherwise land in the same cache
  // slot — and Next tags the RSC response with a `Vary` header
  // (RSC / Next-Router-State-Tree / Next-Router-Prefetch) that a later
  // *real* navigation request, having none of those headers, can never
  // satisfy. Net effect: the in-app client navigation caches the RSC
  // payload under a page's URL, silently evicting or shadowing the real
  // HTML that offline printing actually needs — cache.match() then
  // comes back empty and the fetch throws. Since a hard/offline
  // navigation never sends these headers itself, the RSC response is
  // never useful as an offline fallback anyway — skip caching (and
  // matching against) it entirely so the real document is what ends up
  // cached at that URL.
  const isRSCRequest = request.headers.has('RSC')
    || request.headers.has('Next-Router-State-Tree')
    || request.headers.has('Next-Router-Prefetch');
  if (isRSCRequest) {
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
        // last cached for this exact URL, if anything. ignoreVary
        // guards against any already-poisoned entries this exact
        // browser install cached before this fix shipped (Vary
        // mismatches from a stray RSC response would otherwise still
        // hide a perfectly good match).
        const cached = await cache.match(request, { ignoreVary: true });
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