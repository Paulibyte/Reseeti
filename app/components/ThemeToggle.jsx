'use client';

import { useTheme } from '../ThemeProvider';

export default function ThemeToggle({ compact = false }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--surface-alt)',
        border: '1px solid var(--border)',
        color: 'var(--text-muted)',
        borderRadius: 8,
        padding: compact ? '6px 8px' : '8px 12px',
        fontSize: 12.5,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      <span>{theme === 'light' ? '🌙' : '☀️'}</span>
      {!compact && <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>}
    </button>
  );
}
