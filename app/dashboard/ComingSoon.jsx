export default function ComingSoon({ title, icon, description }) {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: '0 0 16px' }}>
        {title}
      </h1>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px dashed var(--border)',
          borderRadius: 12,
          padding: '48px 24px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 34, marginBottom: 12 }}>{icon}</div>
        <p style={{ fontWeight: 700, color: 'var(--text)', margin: '0 0 6px', fontSize: 15 }}>Coming soon</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5, maxWidth: 340, margin: '0 auto' }}>{description}</p>
      </div>
    </div>
  );
}
