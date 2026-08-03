// Everything PWA-related that isn't specific to invoice syncing lives
// here (offline invoice queueing/background sync is lib/offlineQueue.js —
// this file is about the app shell itself: installing it, updating it,
// and knowing which service worker is in control).
//
// Module-scoped state + subscriber sets, the same pattern
// offlineQueue.js uses for onBackgroundSyncMessage — no external state
// library, just a few listeners that UI components subscribe to.

let deferredInstallPrompt = null;
const installListeners = new Set();

let waitingRegistration = null;
const updateListeners = new Set();

// ---------- Install prompt ----------
//
// Chrome/Edge/most Android browsers fire 'beforeinstallprompt' when the
// PWA criteria are met (manifest + service worker + HTTPS). The browser
// then withholds its own mini-infobar unless we call .prompt() — that's
// what lets InstallPrompt.jsx show Reseeti's own "Install" button instead
// of relying on the browser chrome, and re-offer it later if the person
// dismisses it once. iOS Safari never fires this event at all (there is
// no programmatic install API there) — InstallPrompt.jsx handles that
// case separately with manual "Add to Home Screen" instructions.
export function initInstallPrompt() {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installListeners.forEach((cb) => cb(true));
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installListeners.forEach((cb) => cb(false));
  });
}

export function isInstallAvailable() {
  return !!deferredInstallPrompt;
}

// Returns an unsubscribe function, same shape as
// offlineQueue.js's onBackgroundSyncMessage.
export function onInstallAvailabilityChange(callback) {
  installListeners.add(callback);
  return () => installListeners.delete(callback);
}

// Returns 'accepted', 'dismissed', or null (nothing to prompt).
export async function promptInstall() {
  if (!deferredInstallPrompt) return null;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  // A prompt event can only be used once — clear it either way, and let
  // the browser decide whether/when to offer 'beforeinstallprompt' again
  // (typically not for a while after a dismissal).
  deferredInstallPrompt = null;
  installListeners.forEach((cb) => cb(false));
  return choice.outcome;
}

// Rough device check for the "no beforeinstallprompt at all" case.
// Feature-sniffing this properly isn't really possible — iOS Safari just
// never exposes an install API — so this is a plain UA check, only used
// to decide whether to show manual "Add to Home Screen" instructions
// instead of an Install button.
export function isIOSSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return isIOS && !isStandalone;
}

export function isAlreadyInstalled() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// ---------- Service worker registration + update detection ----------
//
// Deliberately does NOT self.skipWaiting() on install (see sw.js) — a new
// worker sits in the "waiting" state until the person actually agrees to
// update (via UpdateNotification.jsx calling applyUpdate below), so an
// update can never yank the app to new code out from under someone
// mid-invoice. Update checks happen automatically on navigation (browsers
// already do this for registered service workers) plus a periodic
// re-check below, for tabs left open a long time.
export async function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');

    // A worker may already be sitting in 'waiting' if it finished
    // installing in another tab (or earlier this session) before this
    // component mounted.
    if (reg.waiting && navigator.serviceWorker.controller) {
      setWaitingRegistration(reg);
    }

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        // 'installed' + an existing controller means this is a genuine
        // update to a previously-installed app, not the very first
        // install (which also passes through 'installed' but has no
        // controller yet to take over from).
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          setWaitingRegistration(reg);
        }
      });
    });

    // Browsers already check for an update on navigation, but a business
    // owner realistically leaves this tab open all day — this catches
    // that case too, without needing a reload to notice a new version.
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  } catch (err) {
    console.error('Service worker registration failed:', err);
  }
}

function setWaitingRegistration(reg) {
  waitingRegistration = reg;
  updateListeners.forEach((cb) => cb(true));
}

export function isUpdateAvailable() {
  return !!waitingRegistration;
}

export function onUpdateAvailable(callback) {
  updateListeners.add(callback);
  if (waitingRegistration) callback(true);
  return () => updateListeners.delete(callback);
}

// Tells the waiting worker to take over, then reloads once it actually
// does. Reloading is deferred to the 'controllerchange' event rather
// than fired immediately after postMessage — doing it immediately risks
// the reload landing before the new worker has actually taken control,
// which would just load the page under the old one again.
export function applyUpdate() {
  if (!waitingRegistration?.waiting) return;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  waitingRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
}
