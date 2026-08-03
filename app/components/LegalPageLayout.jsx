'use client';

import Link from 'next/link';
import Logo from '../components/Logo';

export default function LegalPageLayout({ title, lastUpdated, children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
        <Link href="/" style={{ textDecoration: 'none' }}>
          <Logo size={32} showWordmark />
        </Link>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 28, margin: '0 0 6px' }}>
          {title}
        </h1>
        <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: '0 0 24px' }}>
          Last updated: {lastUpdated}
        </p>

        <div
          style={{
            background: 'var(--orange-bg)', border: '1px solid var(--orange)', borderRadius: 8,
            padding: '12px 16px', marginBottom: 32, fontSize: 12.5, color: 'var(--orange-dark)', lineHeight: 1.6,
          }}
        >
          <strong>This is a starting template, not legal advice.</strong> It's written to genuinely reflect what
          Reseeti actually does with data — but every business's situation is different, and laws vary by
          jurisdiction. Have a qualified lawyer review this before relying on it as your business's actual policy.
        </div>

        <div style={{ fontSize: 14.5, color: 'var(--text)', lineHeight: 1.75 }}>
          {children}
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-faint)', marginTop: 40 }}>
          <Link href="/privacy" style={{ color: 'var(--text-muted)' }}>Privacy Policy</Link>
          {' · '}
          <Link href="/terms" style={{ color: 'var(--text-muted)' }}>Terms of Service</Link>
          {' · '}
          <Link href="/login" style={{ color: 'var(--text-muted)' }}>Back to Reseeti</Link>
        </p>
      </main>
    </div>
  );
}
