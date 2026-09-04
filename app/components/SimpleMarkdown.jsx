'use client';

// Renders React elements directly (never dangerouslySetInnerHTML) —
// even though only platform admins can write this content, building
// real elements is inherently safe from injection with no extra
// thought needed, and costs nothing extra here.
//
// Supports exactly what was asked for and nothing more: '# Heading',
// '## Smaller heading', '- bullet points' (consecutive ones grouped
// into one list), '[link text](https://...)' inline anywhere, and
// plain paragraphs for everything else. Not a real Markdown parser —
// deliberately narrow, matching this codebase's existing preference
// (see lib/paystack.js, lib/resendEmail.js) for a small hand-rolled
// implementation over pulling in a library for a genuinely simple need.

function renderInline(text, keyPrefix) {
  // Splits on [text](url) without a regex-in-a-loop mutating the
  // string — matchAll collects every link's position once, then the
  // gaps between matches become plain text spans.
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  let i = 0;
  while ((match = linkPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <a key={`${keyPrefix}-link-${i++}`} href={match[2]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--heading)', textDecoration: 'underline' }}>
        {match[1]}
      </a>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export default function SimpleMarkdown({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const blocks = [];
  let bulletBuffer = [];
  let key = 0;

  function flushBullets() {
    if (bulletBuffer.length === 0) return;
    blocks.push(
      <ul key={`ul-${key++}`} style={{ margin: '0 0 12px', paddingLeft: 20 }}>
        {bulletBuffer.map((item, i) => (
          <li key={i} style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.65, marginBottom: 4 }}>
            {renderInline(item, `bullet-${key}-${i}`)}
          </li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { flushBullets(); continue; }

    if (line.startsWith('## ')) {
      flushBullets();
      blocks.push(
        <h3 key={`h3-${key++}`} style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 15, margin: '16px 0 6px' }}>
          {renderInline(line.slice(3), `h3-${key}`)}
        </h3>
      );
    } else if (line.startsWith('# ')) {
      flushBullets();
      blocks.push(
        <h2 key={`h2-${key++}`} style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 17, margin: '18px 0 8px' }}>
          {renderInline(line.slice(2), `h2-${key}`)}
        </h2>
      );
    } else if (line.startsWith('- ')) {
      bulletBuffer.push(line.slice(2));
    } else {
      flushBullets();
      blocks.push(
        <p key={`p-${key++}`} style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.65, margin: '0 0 10px' }}>
          {renderInline(line, `p-${key}`)}
        </p>
      );
    }
  }
  flushBullets();

  return <div>{blocks}</div>;
}
