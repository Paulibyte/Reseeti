'use client';

import { useEffect, useState } from 'react';
import SimpleMarkdown from '../components/SimpleMarkdown';
import { youtubeEmbedUrl } from '../../lib/youtube';

function DocItem({ title, content }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          background: 'none', border: 'none', textAlign: 'left', padding: '14px 0', cursor: 'pointer',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14.5 }}>📄 {title}</span>
        <span style={{ color: 'var(--text-faint)', fontSize: 18, flexShrink: 0 }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div style={{ paddingBottom: 16 }}>
          <SimpleMarkdown text={content} />
        </div>
      )}
    </div>
  );
}

function VideoItem({ title, content, youtubeUrl }) {
  const embedUrl = youtubeEmbedUrl(youtubeUrl);
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14.5, margin: '0 0 4px' }}>🎥 {title}</p>
      {content && <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>{content}</p>}
      {embedUrl ? (
        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
          <iframe
            src={embedUrl}
            title={title}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
          />
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: 'var(--text-faint)' }}>Video link couldn't be loaded.</p>
      )}
    </div>
  );
}

export default function HelpTutorials() {
  const [tutorials, setTutorials] = useState(null);

  useEffect(() => {
    fetch('/api/tutorials')
      .then((res) => res.json())
      .then((data) => setTutorials(data?.tutorials || []))
      .catch(() => setTutorials([]));
  }, []);

  // Renders nothing at all — not even a heading — while loading or if
  // no tutorials exist yet, so the page looks exactly as it always has
  // until an admin actually posts something.
  if (!tutorials || tutorials.length === 0) return null;

  const byCategory = {};
  for (const t of tutorials) {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  }

  return (
    <div style={{ marginBottom: 32 }}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 20, margin: '0 0 16px' }}>
        Documents &amp; video tutorials
      </h1>
      {Object.entries(byCategory).map(([category, items]) => (
        <div key={category} style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 16, margin: '0 0 4px' }}>
            {category}
          </h2>
          {items.filter((t) => t.type === 'video').map((t) => (
            <VideoItem key={t.id} title={t.title} content={t.content} youtubeUrl={t.youtube_url} />
          ))}
          {items.filter((t) => t.type === 'doc').map((t) => (
            <DocItem key={t.id} title={t.title} content={t.content} />
          ))}
        </div>
      ))}
    </div>
  );
}
