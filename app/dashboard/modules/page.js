'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabaseClient';
import { getMyBusiness } from '../../../lib/getMyBusiness';
import DashboardShell from '../DashboardShell';
import { can } from '../../../lib/permissions';

// All five Phase 4 verticals now have a toggle here — each was already
// tagged with a `module` key in navItems.js and covered by
// enabled_modules' default (schema_stage58.sql) from the start, so
// extending School/Hotel to include these three was just adding rows
// here, not re-plumbing anything.
const MODULES = [
  { key: 'school', label: 'School Billing', description: 'Students, Fees, Classes, Sessions & Terms' },
  { key: 'hotel', label: 'Hotel Billing', description: 'Bookings, Rooms' },
  { key: 'construction', label: 'Construction Billing', description: 'Projects' },
  { key: 'clinic', label: 'Clinic Billing', description: 'Visits' },
  { key: 'lab', label: 'Laboratory Billing', description: 'Orders' },
];

export default function ModulesPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState({});
  const [saving, setSaving] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});
    setEnabled(biz.enabled_modules || {});
    setLoading(false);
  }

  async function toggle(key) {
    // Defaults to true (visible) if the key is somehow missing from an
    // older business record — same "visible unless explicitly hidden"
    // stance as the migration itself.
    const next = { ...enabled, [key]: !(enabled[key] !== false) };
    setSaving(key);
    const { error } = await supabase.from('businesses').update({ enabled_modules: next }).eq('id', business.id);
    setSaving(null);
    if (!error) setEnabled(next);
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageSettings', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage modules.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, marginBottom: 4 }}>Modules</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        Turn off a module to hide its pages from the sidebar for everyone on your team — nothing already saved gets
        deleted, it's just hidden until you turn it back on.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
        {MODULES.map((m) => {
          const isOn = enabled[m.key] !== false;
          return (
            <div key={m.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14.5, color: 'var(--text)' }}>{m.label}</p>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-faint)' }}>{m.description}</p>
              </div>
              <button
                onClick={() => toggle(m.key)}
                disabled={saving === m.key}
                style={{
                  background: isOn ? 'var(--success-bg)' : 'var(--surface-alt)',
                  color: isOn ? 'var(--success)' : 'var(--text-faint)',
                  border: 'none', borderRadius: 20, padding: '6px 14px', fontSize: 11.5, fontWeight: 700,
                  textTransform: 'uppercase', cursor: 'pointer',
                }}
              >
                {saving === m.key ? 'Saving…' : isOn ? 'On' : 'Off'}
              </button>
            </div>
          );
        })}
      </div>
    </DashboardShell>
  );
}
