'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../../lib/supabaseClient';
import { getMyBusiness } from '../../../../lib/getMyBusiness';
import DashboardShell from '../../DashboardShell';
import { can } from '../../../../lib/permissions';
import { formatNaira } from '../../../../lib/format';

export default function HotelRoomsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [rate, setRate] = useState('');
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

    const { data } = await supabase.from('hotel_rooms').select('*').eq('business_id', biz.id).order('name');
    setRooms(data || []);
    setLoading(false);
  }

  async function addRoom(e) {
    e.preventDefault();
    if (!name.trim() || !rate) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('hotel_rooms').insert({
      business_id: business.id,
      name: name.trim(),
      room_type: type || null,
      rate_per_night: Number(rate),
    });
    setSaving(false);
    if (err) {
      setError(err.message.includes('duplicate') ? 'A room with this name already exists.' : err.message);
      return;
    }
    setName(''); setType(''); setRate('');
    load();
  }

  async function toggleActive(room) {
    await supabase.from('hotel_rooms').update({ active: !room.active }).eq('id', room.id);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageSettings', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage rooms.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, marginBottom: 4 }}>Rooms</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        Manage bookings from the <a href="/dashboard/hotel/bookings" style={{ color: 'var(--orange)' }}>Bookings</a> page.
      </p>

      <form onSubmit={addRoom} style={{ display: 'flex', gap: 8, marginBottom: 20, maxWidth: 500, flexWrap: 'wrap' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Room 101" style={{ ...inputStyle, flex: 2, minWidth: 140 }} />
        <input value={type} onChange={(e) => setType(e.target.value)} placeholder="Type (optional)" style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
        <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" min="0" placeholder="Rate/night" style={{ ...inputStyle, flex: 1, minWidth: 100 }} />
        <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}>Add</button>
      </form>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: -10, marginBottom: 14 }}>{error}</p>}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, maxWidth: 500 }}>
        {rooms.length === 0 && <p style={{ padding: 16, color: 'var(--text-faint)', margin: 0 }}>No rooms yet — add one above.</p>}
        {rooms.map((r, i) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: i === rooms.length - 1 ? 'none' : '1px solid var(--border)', opacity: r.active ? 1 : 0.55 }}>
            <div>
              <span style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>{r.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 8 }}>
                {r.room_type ? `${r.room_type} · ` : ''}{formatNaira(r.rate_per_night)}/night{!r.active ? ' · Inactive' : ''}
              </span>
            </div>
            <button onClick={() => toggleActive(r)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', fontSize: 11.5, cursor: 'pointer' }}>
              {r.active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}

const inputStyle = { padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 };
