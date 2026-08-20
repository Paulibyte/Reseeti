'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../../lib/supabaseClient';
import { getMyBusiness } from '../../../../lib/getMyBusiness';
import DashboardShell from '../../DashboardShell';
import { can } from '../../../../lib/permissions';

export default function SchoolSessionsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [terms, setTerms] = useState([]);
  const [newSessionName, setNewSessionName] = useState('');
  const [newTermName, setNewTermName] = useState({}); // session_id -> text
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const { data: s } = await supabase.from('school_sessions').select('*').eq('business_id', biz.id).order('created_at', { ascending: false });
    const { data: t } = await supabase.from('school_terms').select('*').eq('business_id', biz.id).order('created_at');
    setSessions(s || []);
    setTerms(t || []);
    setLoading(false);
  }

  async function addSession(e) {
    e.preventDefault();
    if (!newSessionName.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('school_sessions').insert({ business_id: business.id, name: newSessionName.trim() });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setNewSessionName('');
    load();
  }

  async function setCurrentSession(session) {
    // Only one session should be "current" at a time — clear the rest first.
    await supabase.from('school_sessions').update({ is_current: false }).eq('business_id', business.id);
    await supabase.from('school_sessions').update({ is_current: true }).eq('id', session.id);
    load();
  }

  async function addTerm(sessionId) {
    const name = (newTermName[sessionId] || '').trim();
    if (!name) return;
    const { error: err } = await supabase.from('school_terms').insert({ business_id: business.id, session_id: sessionId, name });
    if (err) { setError(err.message); return; }
    setNewTermName((prev) => ({ ...prev, [sessionId]: '' }));
    load();
  }

  async function setCurrentTerm(term) {
    // Current term is scoped within its own session, not globally, since
    // a business could plausibly still be closing out a previous
    // session's last term while setting up the next one's first.
    await supabase.from('school_terms').update({ is_current: false }).eq('session_id', term.session_id);
    await supabase.from('school_terms').update({ is_current: true }).eq('id', term.id);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageInventory', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage sessions.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, marginBottom: 4 }}>Sessions & Terms</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        The current term is what &quot;Generate invoices for this term&quot; (on the Fees page) uses by default.
      </p>

      <form onSubmit={addSession} style={{ display: 'flex', gap: 8, marginBottom: 20, maxWidth: 400 }}>
        <input
          value={newSessionName}
          onChange={(e) => setNewSessionName(e.target.value)}
          placeholder="e.g. 2025/2026"
          style={{ flex: 1, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }}
        />
        <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}>
          Add session
        </button>
      </form>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: -10, marginBottom: 14 }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 500 }}>
        {sessions.length === 0 && <p style={{ color: 'var(--text-faint)' }}>No sessions yet — add one above.</p>}
        {sessions.map((s) => {
          const sessionTerms = terms.filter((t) => t.session_id === s.id);
          return (
            <div key={s.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--heading)' }}>{s.name}</span>
                {s.is_current ? (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', padding: '3px 9px', borderRadius: 20, textTransform: 'uppercase' }}>Current</span>
                ) : (
                  <button onClick={() => setCurrentSession(s)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer' }}>Set as current</button>
                )}
              </div>

              {sessionTerms.map((t) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13.5 }}>{t.name}</span>
                  {t.is_current ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--success)' }}>● Current term</span>
                  ) : (
                    <button onClick={() => setCurrentTerm(t)} style={{ background: 'none', border: 'none', color: 'var(--orange)', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 }}>Set as current</button>
                  )}
                </div>
              ))}

              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <input
                  value={newTermName[s.id] || ''}
                  onChange={(e) => setNewTermName((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  placeholder="e.g. First Term"
                  style={{ flex: 1, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5 }}
                />
                <button onClick={() => addTerm(s.id)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}>
                  + Term
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </DashboardShell>
  );
}
