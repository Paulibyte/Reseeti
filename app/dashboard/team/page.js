'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can, ROLE_LABELS, ASSIGNABLE_ROLES, PERMISSION_LABELS, PERMISSION_ORDER, permissionsFor } from '../../../lib/permissions';

// Converts a Nigerian local number (08012345678) to E.164 format
// (+2348012345678), matching the format the login page's OTP flow uses —
// invites are keyed on phone, so this must match exactly or a staff
// member's signup won't find their pending invite.
function toE164(input) {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('0')) return '+234' + digits.slice(1);
  if (digits.startsWith('234')) return '+' + digits;
  return '+234' + digits;
}

function PermissionTable({ role }) {
  const perms = permissionsFor(role);
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {PERMISSION_ORDER.map((p) => (
        <div key={p} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}>
          <span style={{ color: 'var(--text-muted)' }}>{PERMISSION_LABELS[p]}</span>
          <span style={{ fontWeight: 700, color: perms[p] ? 'var(--success)' : 'var(--danger)' }}>{perms[p] ? '✓' : '✗'}</span>
        </div>
      ))}
    </div>
  );
}

export default function TeamPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteLabel, setInviteLabel] = useState('');
  const [inviteRole, setInviteRole] = useState('cashier');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expandedRole, setExpandedRole] = useState(null);
  const [changingRoleFor, setChangingRoleFor] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);

    if (biz) {
      const { data: mem } = await supabase
        .from('business_members')
        .select('*')
        .eq('business_id', biz.id)
        .order('role')
        .order('invited_at');
      setMembers(mem || []);
    }
    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  // Only the literal owner can hand out the Manager role — a Manager
  // inviting someone can only pick Cashier/Salesperson/Accountant. This
  // is enforced here for a clean UI, and again at the database level (see
  // schema_stage18.sql's prevent_role_escalation trigger) so it holds even
  // against a direct API call, not just through this form.
  const assignableRoles = role === 'owner' ? ASSIGNABLE_ROLES : ASSIGNABLE_ROLES.filter((r) => r !== 'manager');

  async function inviteStaff(e) {
    e.preventDefault();
    setError('');
    setSaving(true);

    const { error: err } = await supabase.from('business_members').insert({
      business_id: business.id,
      phone: toE164(invitePhone),
      label: inviteLabel || null,
      role: inviteRole,
      status: 'invited',
    });

    setSaving(false);
    if (err) {
      setError(err.message.includes('duplicate') ? 'This phone number already has access.' : err.message);
      return;
    }
    setInvitePhone('');
    setInviteLabel('');
    setInviteRole('cashier');
    setShowInvite(false);
    load();
  }

  async function changeRole(member, newRole) {
    setChangingRoleFor(member.id);
    const { error: err } = await supabase.from('business_members').update({ role: newRole }).eq('id', member.id);
    setChangingRoleFor(null);
    if (err) {
      alert(err.message.includes('Only the business owner') ? err.message : `Couldn't change role: ${err.message}`);
      return;
    }
    load();
  }

  async function removeMember(member) {
    if (!confirm(`Remove ${member.label || member.phone}'s access to this business?`)) return;
    await supabase.from('business_members').delete().eq('id', member.id);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  // Not authorized — this page shouldn't have been reachable via the nav
  // (Sidebar only shows "Team" to roles with manageTeam), but someone
  // could still type the URL directly, so this is a real guard, not just
  // a UI nicety. The database-level RLS backs this up independently too.
  if (!can(role, 'manageTeam')) {
    return (
      <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage the team.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} onSignOut={signOut}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>
          Team
        </h1>
        <button
          onClick={() => setShowInvite(true)}
          style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}
        >
          + Invite team member
        </button>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
        Each role has its own set of permissions — tap a role below to see exactly what it can and can&apos;t do.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.keys(ROLE_LABELS).filter((r) => r !== 'owner').map((r) => (
          <button
            key={r}
            onClick={() => setExpandedRole(expandedRole === r ? null : r)}
            style={{
              padding: '7px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${expandedRole === r ? 'var(--orange)' : 'var(--border)'}`,
              background: expandedRole === r ? 'var(--orange-bg)' : 'var(--surface)',
              color: expandedRole === r ? 'var(--orange)' : 'var(--text-muted)',
            }}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>

      {expandedRole && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <p style={{ margin: '0 0 10px', fontWeight: 700, color: 'var(--heading)', fontSize: 14 }}>{ROLE_LABELS[expandedRole]} permissions</p>
          <PermissionTable role={expandedRole} />
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {members.map((m, idx) => (
          <div
            key={m.id}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '13px 16px', borderBottom: idx === members.length - 1 ? 'none' : '1px solid var(--border)',
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', fontSize: 14.5 }}>
                {m.label || m.phone}
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                {m.label ? `${m.phone} · ` : ''}
                {ROLE_LABELS[m.role] || m.role}
                {m.status === 'invited' ? ' · Invited, not yet joined' : ''}
              </p>
            </div>
            {m.role !== 'owner' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {/* Only the owner can reassign roles — a manager can invite/remove
                    but not shuffle people into or out of Manager-level access. */}
                {role === 'owner' && (
                  <select
                    value={m.role}
                    disabled={changingRoleFor === m.id}
                    onChange={(e) => changeRole(m, e.target.value)}
                    style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5, background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}
                  >
                    {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                )}
                <button
                  onClick={() => removeMember(m)}
                  style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showInvite && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 400, width: '100%', borderTop: '5px solid var(--orange)' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>Invite team member</h3>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -4, marginBottom: 14, lineHeight: 1.5 }}>
              They'll get access the moment they log into Reseeti with this exact phone number —
              no separate signup step, and no SMS gets sent from here.
            </p>
            <form onSubmit={inviteStaff}>
              <label style={labelStyle}>Phone number</label>
              <input
                required
                type="tel"
                placeholder="08012345678"
                value={invitePhone}
                onChange={(e) => setInvitePhone(e.target.value)}
                style={inputStyle}
              />
              <label style={labelStyle}>Name (optional, just for your own reference)</label>
              <input
                placeholder="e.g. Ngozi"
                value={inviteLabel}
                onChange={(e) => setInviteLabel(e.target.value)}
                style={inputStyle}
              />
              <label style={labelStyle}>Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '-6px 0 10px' }}>
                Tap a role above the team list to see exactly what {ROLE_LABELS[inviteRole].toLowerCase()}s can do.
              </p>
              {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Inviting…' : 'Send invite'}
                </button>
                <button type="button" onClick={() => setShowInvite(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 10 };
const inputStyle = {
  width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14,
  boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)', marginBottom: 10,
};
