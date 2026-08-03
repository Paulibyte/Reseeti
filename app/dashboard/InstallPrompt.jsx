'use client';

import { useEffect, useState } from 'react';
import {
  onInstallAvailabilityChange,
  isInstallAvailable,
  promptInstall,
  isIOSSafari,
  isAlreadyInstalled,
  onUpdateAvailable,
} from '../../lib/pwa';

const DISMISSED_KEY = 'reseeti_install_dismissed_at';
// Re-offer after a while rather than never again — someone who dismissed
// it in their first five minutes on the app might well want it once
// they've made it a daily habit.
const RE_PROMPT_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function wasRecentlyDismissed() {
  const raw = localStorage.getItem(DISMISSED_KEY);
  if (!raw) return false;
  return Date.now() - Number(raw) < RE_PROMPT_AFTER_MS;
}

export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState('android'); // 'android' | 'ios'
  const [installing, setInstalling] = useState(false);
  const [updatePending, setUpdatePending] = useState(false);

  useEffect(() => onUpdateAvailable(setUpdatePending), []);

  useEffect(() => {
    if (isAlreadyInstalled() || wasRecentlyDismissed()) return;

    if (isIOSSafari()) {
      setMode('ios');
      setVisible(true);
      return;
    }

    if (isInstallAvailable()) setVisible(true);
    return onInstallAvailabilityChange((available) => setVisible(available && !wasRecentlyDismissed()));
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setVisible(false);
  }

  async function handleInstall() {
    setInstalling(true);
    const outcome = await promptInstall();
    setInstalling(false);
    // 'accepted', 'dismissed', or null if the deferred prompt had already
    // expired — any of those means there's nothing more for this banner
    // to do right now.
    if (outcome !== null) setVisible(false);
  }

  if (!visible || updatePending) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: 20,
        right: 20,
        bottom: 90,
        maxWidth: 420,
        margin: '0 auto',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: 'var(--shadow)',
        zIndex: 55,
      }}
    >
      <span style={{ fontSize: 22, flexShrink: 0 }}>📲</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--heading)' }}>
          Install Reseeti
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
          {mode === 'ios'
            ? <>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</>
            : 'Add it to your home screen for faster access, even offline.'}
        </p>
      </div>
      {mode === 'android' && (
        <button
          onClick={handleInstall}
          disabled={installing}
          style={{
            background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6,
            padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: installing ? 'default' : 'pointer', flexShrink: 0,
          }}
        >
          {installing ? 'Installing…' : 'Install'}
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 16,
          cursor: 'pointer', flexShrink: 0, padding: 2, lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}
