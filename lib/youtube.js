// Accepts whatever an admin might actually paste from YouTube — a full
// watch link, a shortened youtu.be link, or an already-embed link —
// and returns just the 11-character video id, or null if nothing
// recognizable was found. Deliberately permissive about extra query
// params (timestamps, playlist ids) tacked onto the end, since those
// are exactly what people copy-paste without editing.
export function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/embed/')[1]?.split('/')[0] || null;
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/shorts/')[1]?.split('/')[0] || null;
    }
    return null;
  } catch {
    return null;
  }
}

export function youtubeEmbedUrl(url) {
  const id = extractYouTubeId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}
