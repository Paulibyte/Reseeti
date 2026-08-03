import Image from 'next/image';

export default function Logo({ size = 40, showWordmark = false, style = {} }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...style }}>
      <Image
        src="/logo.png"
        alt="Reseeti"
        width={size}
        height={size}
        priority
        style={{ objectFit: 'contain', flexShrink: 0, width: size, height: size }}
      />
      {showWordmark && (
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: size * 0.55, color: 'var(--heading)', letterSpacing: 0.3 }}>
          Reseeti
        </span>
      )}
    </div>
  );
}
