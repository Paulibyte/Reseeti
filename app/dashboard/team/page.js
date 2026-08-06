'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can, ROLE_LABELS, ASSIGNABLE_ROLES, PERMISSION_LABELS, PERMISSION_ORDER, permissionsFor } from '../../../lib/permissions';

// Number of permissions a member's overrides have actually pulled away
// from their role's default — used for the "+2 custom" badge in the
// member list, so an owner can spot at a glance who's been individually
// tuned without opening every row.
function overrideCount(overrides) {
  return Object.keys(overrides || {}).length;
}

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
  const [overrides, setOverrides] = useState({});
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
  const [editingPermsFor, setEditingPermsFor] = useState(null);
  const [permDraft, setPermDraft] = useState({});
  const [savingPerms, setSavingPerms] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

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

  function openPermEditor(member) {
    setEditingPermsFor(member);
    // Start from exactly what's stored — not the merged/effective view —
    // so toggling one flag and saving doesn't accidentally freeze every
    // other flag's current role-derived value in as an explicit override
    // it would then no longer track if the role itself changes later.
    setPermDraft({ ...(member.permission_overrides || {}) });
  }

  // Toggling a flag either adds/updates an explicit override, or — if the
  // new value matches what the role would already give them — removes
  // the override entirely. This is what keeps permission_overrides sparse
  // (only genuinely customized flags), so a role's own template stays the
  // source of truth for everything an owner hasn't deliberately touched.
  function togglePerm(perm) {
    if (!editingPermsFor) return;
    const roleDefault = can(editingPermsFor.role, perm);
    const currentlyEffective = can(editingPermsFor.role, perm, permDraft);
    const nextValue = !currentlyEffective;
    setPermDraft((prev) => {
      const next = { ...prev };
      if (nextValue === roleDefault) {
        delete next[perm];
      } else {
        next[perm] = nextValue;
      }
      return next;
    });
  }

  async function savePerms() {
    if (!editingPermsFor) return;
    setSavingPerms(true);
    const { error: err } = await supabase
      .from('business_members')
      .update({ permission_overrides: permDraft })
      .eq('id', editingPermsFor.id);
    setSavingPerms(false);
    if (err) {
      alert(`Couldn't save permissions: ${err.message}`);
      return;
    }
    setEditingPermsFor(null);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }

  // Not authorized — this page shouldn't have been reachable via the nav
  // (Sidebar only shows "Team" to roles with manageTeam), but someone
  // could still type the URL directly, so this is a real guard, not just
  // a UI nicety. The database-level RLS backs this up independently too.
  if (!can(role, 'manageTeam', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides} onSignOut={signOut}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage the team.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides} onSignOut={signOut}>
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
                {overrideCount(m.permission_overrides) > 0 && (
                  <span style={{ color: 'var(--orange-dark)', fontWeight: 700 }}>
                    {' · '}+{overrideCount(m.permission_overrides)} custom
                  </span>
                )}
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
                  onClick={() => openPermEditor(m)}
                  style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                >
                  Permissions
                </button>
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

      {editingPermsFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 24, maxWidth: 420, width: '100%', borderTop: '5px solid var(--orange)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0, marginBottom: 2 }}>
              {editingPermsFor.label || editingPermsFor.phone}&apos;s permissions
            </h3>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
              Starts from what a {ROLE_LABELS[editingPermsFor.role]?.toLowerCase()} normally gets. Untick or tick
              anything to give this person a custom exception — everything else stays tied to their role.
            </p>
            <div style={{ overflowY: 'auto', flex: 1, marginBottom: 14 }}>
              {PERMISSION_ORDER.map((p) => {
                const roleDefault = can(editingPermsFor.role, p);
                const effective = can(editingPermsFor.role, p, permDraft);
                const isCustom = Object.prototype.hasOwnProperty.call(permDraft, p);
                return (
                  <label
                    key={p}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '9px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13.5,
                    }}
                  >
                    <span style={{ color: 'var(--text)' }}>
                      {PERMISSION_LABELS[p]}
                      {isCustom && (
                        <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: 'var(--orange-dark)', textTransform: 'uppercase' }}>
                          custom
                        </span>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={effective}
                      onChange={() => togglePerm(p)}
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--orange)' }}
                    />
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={savePerms}
                disabled={savingPerms}
                style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
              >
                {savingPerms ? 'Saving…' : 'Save permissions'}
              </button>
              <button
                type="button"
                onClick={() => setEditingPermsFor(null)}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
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
