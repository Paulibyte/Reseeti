'use client';

export default function MobileFAB({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="reseeti-fab"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 24,
        zIndex: 40,
        alignItems: 'center',
        gap: 8,
        background: 'var(--orange)',
        color: '#fff',
        border: 'none',
        borderRadius: 30,
        padding: '14px 20px',
        fontWeight: 700,
        fontSize: 14,
        boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
      Create Invoice
    </button>
  );
}
