import Link from 'next/link';
import Logo from './components/Logo';

const FEATURES = [
  { icon: '🧾', label: 'Unlimited Professional Invoices' },
  { icon: '📱', label: 'Phone Number Login' },
  { icon: '☁️', label: 'Cloud Sync' },
  { icon: '📄', label: 'PDF Export' },
  { icon: '💬', label: 'WhatsApp Sharing' },
  { icon: '💳', label: 'Online Payments' },
];

export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '64px 20px 40px',
      }}
    >
      <div style={{ maxWidth: 440, width: '100%', textAlign: 'center' }}>
        <Logo size={64} style={{ justifyContent: 'center', marginBottom: 14 }} />
        <h1
          style={{
            fontFamily: 'var(--font-heading)',
            color: 'var(--heading)',
            fontSize: 30,
            fontWeight: 900,
            margin: '0 0 8px',
            letterSpacing: 0.5,
          }}
        >
          RESEETI
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-heading)',
            color: 'var(--text)',
            fontSize: 17,
            fontWeight: 700,
            margin: '0 0 14px',
          }}
        >
          Smart Invoicing for African Businesses
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.6, margin: '0 0 28px' }}>
          Create professional invoices, share them instantly, track payments and grow your business.
        </p>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0 0 24px' }} />

        <div style={{ display: 'grid', gap: 14, textAlign: 'left', marginBottom: 28 }}>
          {FEATURES.map((f) => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{f.icon}</span>
              <span style={{ color: 'var(--text)', fontSize: 14.5, fontWeight: 500 }}>{f.label}</span>
            </div>
          ))}
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0 0 28px' }} />

        <Link
          href="/login"
          style={{
            display: 'block',
            width: '100%',
            background: 'var(--orange)',
            color: '#fff',
            padding: '14px 24px',
            borderRadius: 10,
            textDecoration: 'none',
            fontWeight: 700,
            fontSize: 15.5,
            boxShadow: 'var(--shadow)',
          }}
        >
          Get Started
        </Link>

        <p style={{ color: 'var(--text-faint)', fontSize: 12.5, lineHeight: 1.6, marginTop: 28 }}>
          Trusted by SMEs, Traders, Freelancers and Service Providers
          <br />
          across Africa.
        </p>
      </div>
    </main>
  );
}
