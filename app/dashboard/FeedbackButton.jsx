'use client';

import { useState } from 'react';
import { csrfFetch } from '../../lib/csrfFetch';

const CATEGORIES = [
  { value: 'bug', label: '🐛 Something\'s broken' },
  { value: 'idea', label: '💡 I have an idea' },
  { value: 'other', label: '💬 Something else' },
];

// Available from every page under /dashboard (see DashboardShell.jsx) —
// a small tab on the side of the screen rather than a prominent button,
// since it's a secondary action most visits never need. Optionally
// captures a screenshot of the current page via html2canvas (already a
// dependency, used elsewhere for PDF generation) so a bug report can
// show, not just tell.
export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('bug');
  const [message, setMessage] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError('');

    let screenshotBase64 = null;
    if (includeScreenshot) {
      try {
        const html2canvas = (await import('html2canvas')).default;
        // Capture the page as it looks right now, behind this modal —
        // the modal itself isn't hidden here, which is fine; the
        // point is showing what screen the person was on, not a
        // pixel-perfect capture excluding this dialog.
        const canvas = await html2canvas(document.body, { scale: 0.6, logging: false, useCORS: true });
        screenshotBase64 = canvas.toDataURL('image/png').split(',')[1];
      } catch {
        // A failed screenshot capture shouldn't block sending the
        // written feedback itself.
      }
    }

    try {
      const res = await csrfFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, message, pageUrl: window.location.href, screenshotBase64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send feedback.');
      setSent(true);
      setMessage('');
    } catch (err) {
      setError(err.message);
    }
    setSending(false);
  }

  function close() {
    setOpen(false);
    setTimeout(() => { setSent(false); setError(''); }, 300);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        style={{
          position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%) rotate(-90deg) translateY(-50%)',
          transformOrigin: 'right center', background: 'var(--heading)', color: '#fff', border: 'none',
          borderRadius: '8px 8px 0 0', padding: '8px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          zIndex: 45, letterSpacing: 0.3,
        }}
      >
        Feedback
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 65 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 420, width: '100%' }}>
            {sent ? (
              <>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--heading)', margin: '0 0 8px' }}>Thanks!</p>
                <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 18px' }}>
                  Your feedback has been sent. We read every one of these.
                </p>
                <button onClick={close} style={primaryBtnStyle}>Close</button>
              </>
            ) : (
              <form onSubmit={submit}>
                <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, marginBottom: 14 }}>
                  Send feedback
                </h3>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCategory(c.value)}
                      style={{
                        flex: 1, padding: '8px 6px', fontSize: 11.5, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                        border: category === c.value ? '1.5px solid var(--orange)' : '1px solid var(--border)',
                        background: category === c.value ? 'var(--orange-bg)' : 'none',
                        color: category === c.value ? 'var(--orange-dark)' : 'var(--text-muted)',
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What's going on?"
                  required
                  rows={5}
                  style={{ width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13.5, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', background: 'var(--bg)', color: 'var(--text)' }}
                />

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)', margin: '10px 0 16px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={includeScreenshot} onChange={(e) => setIncludeScreenshot(e.target.checked)} />
                  Include a screenshot of this screen
                </label>

                {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 10 }}>{error}</p>}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" disabled={sending || !message.trim()} style={primaryBtnStyle}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                  <button type="button" onClick={close} style={secondaryBtnStyle}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const primaryBtnStyle = {
  background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 18px',
  fontSize: 13.5, fontWeight: 700, cursor: 'pointer', flex: 1,
};
const secondaryBtnStyle = {
  background: 'none', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '10px 18px',
  fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
};
