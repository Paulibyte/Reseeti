# Reseeti — Stage 20: PWA Improvements

Reseeti has had a service worker and a manifest since Stage 9 (offline
shell caching, the invoice-draft offline queue), and Stage 19 added
Background Sync and smarter caching on top of that. What was still
missing was the surrounding *experience* of being an installable app —
nothing told someone they could install it, nothing told them when
they'd lost connection outside the dashboard home page, and a new
service worker version used to just silently take over mid-session.
This stage is entirely that surrounding layer. No new backend, no
schema changes.

Seven pieces, all new except where noted:

## 1. Install prompt

`app/dashboard/InstallPrompt.jsx` + the install-prompt half of
`lib/pwa.js`. Chrome/Edge/Android fire a `beforeinstallprompt` event
once the PWA install criteria are met; this used to go unhandled (the
browser would show its own address-bar icon at best). Now it's
captured, and Reseeti shows its own dismissible banner with an
**Install** button. Dismissing it stores a timestamp in localStorage and
the banner stays away for 14 days rather than nagging every visit — long
enough to not be annoying, short enough that someone who dismissed it
early on and later made Reseeti a daily habit gets asked again.

iOS Safari never fires `beforeinstallprompt` at all — there's no
programmatic install API there — so `isIOSSafari()` detects that case
and the banner switches to manual instructions ("Tap Share, then Add to
Home Screen") instead of a button that would do nothing.

## 2. Offline badge

`app/dashboard/OfflineBadge.jsx`, now in `DashboardShell`'s header — so
it's visible on **every** page under `/dashboard`, not just the
dashboard home. It only renders anything at all while offline (a
constant "Online" pill everywhere would just be noise); the moment
connectivity drops, a small "● Offline" pill appears next to the
notification bell.

This is deliberately separate from the detailed offline/syncing banner
that already lived on `dashboard/page.js` (queued-draft count, "Sync
now" button) — that banner is specific to the invoice-drafting flow and
stays exactly where it was. The badge is the lightweight, always-there
version for every other page (Customers, Inventory, Reports, …), where
previously there was no offline awareness at all — someone could be
offline on the Reports page with zero indication until an action
actually failed. Between the two, this closes out both "offline badge"
and "offline indicator" from the request.

## 3. Background Sync

Already shipped in Stage 19 (`lib/offlineQueue.js`'s
`requestBackgroundSync`, `public/sw.js`'s `sync` event handler) — kept
as-is here, no changes needed. Flagging it explicitly in this README
since it's part of the same "make this feel like a real PWA" theme as
the rest of this stage, even though the code predates it.

## 4. Update notification

The biggest behavioral change in this stage. Previously, `sw.js` called
`self.skipWaiting()` unconditionally on install, meaning a new service
worker version activated the instant it finished downloading — possibly
switching the app to new code while someone was mid-invoice, with zero
warning.

Now:
- `sw.js`'s `install` handler no longer calls `skipWaiting()`. A newly
  installed worker sits in the `waiting` state.
- `lib/pwa.js`'s `registerServiceWorker()` watches for that: it detects
  a genuine update (as opposed to the very first install, which also
  passes through an "installed" state but has no existing controller to
  replace), and notifies subscribers via `onUpdateAvailable`.
- `app/dashboard/UpdateNotification.jsx` subscribes to that and shows a
  bottom banner: *"A new version of Reseeti is available"* with a
  **Refresh** button.
- Clicking Refresh calls `applyUpdate()`, which `postMessage`s
  `{ type: 'SKIP_WAITING' }` to the waiting worker — `sw.js` now has a
  `message` listener that calls `self.skipWaiting()` only on that
  signal — and reloads once the new worker actually takes control
  (listening for `controllerchange`, not reloading immediately after
  the postMessage, so the reload can't land before the handoff finishes
  and re-load under the *old* worker).

Ignoring the banner is completely safe — the app keeps working
correctly on the old version indefinitely; the update is picked up
naturally the next time the tab is closed and reopened even without
ever clicking Refresh.

## 5. Automatic cache cleanup

Two layers, one old and one new:
- **Cross-version cleanup** (existing, since Stage 9): `activate`
  deletes every cache except the current `CACHE_NAME`, so upgrading
  never leaves an old version's cache sitting around forever.
- **Within-version cleanup** (new): the runtime cache itself now has a
  cap (`MAX_CACHE_ENTRIES = 200` in `sw.js`). Every time a response is
  cached, `trimCache()` checks the count and deletes the oldest entries
  (by insertion order — `Cache.keys()` returns entries in the order
  they were added) if it's over the limit. Without this, a business
  that's been using Reseeti for a year — lots of distinct invoice pages
  visited, lots of distinct receipt images — would slowly accumulate an
  ever-growing cache with no natural ceiling.

## 6. Offline indicator

See §2 — the existing detailed banner on the dashboard home page (queued
drafts, sync status, "Sync now") plus the new global `OfflineBadge`
together cover this: one detailed and contextual, one lightweight and
everywhere.

## 7. App version display

`lib/version.js` reads `package.json`'s `version` field as the single
source of truth (bumped to match the stage number, starting with this
one — `20.0.0`), and `app/dashboard/AppVersion.jsx` renders it as
`Reseeti v20.0.0`. Shown in two places, chosen so it's reachable
regardless of screen size:
- The **Sidebar** footer — visible on desktop, where the sidebar itself
  is visible (≥880px).
- The bottom of the **Business Settings** panel — reachable from the ⚙️
  icon in the header on every screen size, including mobile, where the
  sidebar is hidden.

Useful for support conversations ("what version are you on?") and for
confirming an update (§4) actually landed.

## Setup

No migration, no new environment variables, no new dependencies —
everything here builds on the manifest and service worker Reseeti
already had.

### Test the full loop
1. **Install prompt**: open the app in Chrome on Android (or desktop
   Chrome), confirm the "Install Reseeti" banner appears if the app
   isn't already installed, and that Install actually triggers the
   browser's install flow. Dismiss it, reload, confirm it stays hidden.
   On an iPhone in Safari, confirm the banner shows the manual
   "Tap Share, then Add to Home Screen" instructions instead.
2. **Offline badge**: go offline (DevTools → Network → Offline),
   navigate to Customers or Reports (not the dashboard home), confirm
   the "● Offline" pill appears next to the bell icon. Go back online,
   confirm it disappears.
3. **Update notification**: change `CACHE_NAME` in `sw.js` to a new
   value (simulating a deploy), reload the app once so the new worker
   installs, then reload again — confirm the "new version available"
   banner appears with a Refresh button, and that clicking it reloads
   the page under the new worker (check Application → Service Workers
   in DevTools to confirm the new one is now "activated").
4. **Cache cleanup**: in DevTools → Application → Cache Storage, browse
   enough distinct pages to approach 200 cached entries (or temporarily
   lower `MAX_CACHE_ENTRIES` for testing) and confirm the cache doesn't
   grow past the cap.
5. **App version**: confirm "Reseeti v20.0.0" shows in the sidebar
   footer on desktop, and in Business Settings on mobile.
6. **Background sync**: unchanged from Stage 19 — see that README's
   test steps if you want to re-verify it.

## What's deliberately left out of this stage

- **Push notifications** — a separate, much bigger feature (needs a
  push subscription flow, a server-side sender, and a real reason to
  notify someone — "invoice paid" being the obvious one). Not
  implied by "PWA improvements" on its own; left for a stage where
  there's an actual notification-worthy event to wire it to.
- **A dedicated "About" or "Updates" settings page** — the version
  display (§7) is intentionally just a small text line, not a full
  changelog UI. If support conversations start needing "what changed in
  this version," that's a reasonable follow-up.
- **Precached app-shell manifest** — still the runtime cache-as-you-go
  strategy, for the same reason as every prior stage: Next.js's hashed
  bundle filenames make a static precache list go stale on every build.
- **Time-based (rather than count-based) cache expiry** — §5's cleanup
  is a simple entry-count cap. Expiring entries after N days would need
  storing a timestamp per entry (the Cache API doesn't track insertion
  time itself), which is a fair bit more bookkeeping for a benefit the
  count cap already covers reasonably well.
