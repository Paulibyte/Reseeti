'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../../lib/supabaseClient';
import { getMyBusiness } from '../../../../lib/getMyBusiness';
import DashboardShell from '../../DashboardShell';
import { can } from '../../../../lib/permissions';
import { formatNaira } from '../../../../lib/format';

const STATUS_LABELS = { booked: 'Booked', checked_in: 'Checked in', checked_out: 'Checked out', cancelled: 'Cancelled' };

function nightsBetween(checkIn, checkOut) {
  const ms = new Date(checkOut) - new Date(checkIn);
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

export default function HotelBookingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [business, setBusiness] = useState(null);
  const [role, setRole] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [invoicing, setInvoicing] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { user, business: biz, role: myRole, overrides: myOverrides } = await getMyBusiness(supabase);
    if (!user) { router.push('/login'); return; }
    if (!biz) { setLoading(false); return; }
    setBusiness(biz);
    setRole(myRole);
    setOverrides(myOverrides || {});

    const [{ data: b }, { data: r }, { data: c }] = await Promise.all([
      supabase.from('hotel_bookings').select('*, hotel_rooms(name, rate_per_night)').eq('business_id', biz.id).order('check_in', { ascending: false }),
      supabase.from('hotel_rooms').select('*').eq('business_id', biz.id).eq('active', true).order('name'),
      supabase.from('customers').select('id, name, phone').eq('business_id', biz.id).order('name'),
    ]);
    setBookings(b || []);
    setRooms(r || []);
    setCustomers(c || []);
    setLoading(false);
  }

  async function updateStatus(booking, status) {
    await supabase.from('hotel_bookings').update({ status }).eq('id', booking.id);
    load();
  }

  async function invoiceBooking(booking) {
    setInvoicing(booking.id);
    const nights = nightsBetween(booking.check_in, booking.check_out);
    const rate = Number(booking.hotel_rooms?.rate_per_night || 0);
    const total = nights * rate;

    const { data: invoice, error } = await supabase
      .from('invoices')
      .insert({
        business_id: business.id,
        customer_id: booking.customer_id,
        customer_name: booking.guest_name,
        customer_phone: booking.guest_phone,
        subtotal: total,
        discount: 0,
        total,
      })
      .select('id')
      .single();

    if (!error) {
      await supabase.from('invoice_items').insert({
        invoice_id: invoice.id,
        description: `${booking.hotel_rooms?.name || 'Room'} — ${nights} night${nights === 1 ? '' : 's'} (${booking.check_in} to ${booking.check_out})`,
        qty: nights,
        price: rate,
        sort_order: 0,
      });
      await supabase.from('hotel_bookings').update({ invoice_id: invoice.id }).eq('id', booking.id);
    }
    setInvoicing(null);
    load();
  }

  if (loading || !business) {
    return <main style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</main>;
  }
  if (!can(role, 'manageSettings', overrides)) {
    return (
      <DashboardShell plan={business.plan} role={role} overrides={overrides}>
        <p style={{ color: 'var(--text-muted)' }}>You don&apos;t have permission to manage bookings.</p>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell plan={business.plan} role={role} overrides={overrides}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', fontSize: 22, margin: 0 }}>Bookings</h1>
        <button onClick={() => setShowForm(true)} style={{ background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}>
          + New booking
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 18 }}>
        Manage rooms on the <a href="/dashboard/hotel/rooms" style={{ color: 'var(--orange)' }}>Rooms</a> page first.
      </p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
        {bookings.length === 0 && <p style={{ padding: 16, color: 'var(--text-faint)', margin: 0 }}>No bookings yet.</p>}
        {bookings.map((b, i) => {
          const nights = nightsBetween(b.check_in, b.check_out);
          const total = nights * Number(b.hotel_rooms?.rate_per_night || 0);
          return (
            <div key={b.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: i === bookings.length - 1 ? 'none' : '1px solid var(--border)' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{b.guest_name} · {b.hotel_rooms?.name}</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                  {b.check_in} → {b.check_out} · {nights} night{nights === 1 ? '' : 's'} · {formatNaira(total)} · {STATUS_LABELS[b.status]}
                  {b.invoice_id && ' · Invoiced'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {b.status === 'booked' && (
                  <button onClick={() => updateStatus(b, 'checked_in')} style={smallBtnStyle}>Check in</button>
                )}
                {b.status === 'checked_in' && (
                  <button onClick={() => updateStatus(b, 'checked_out')} style={smallBtnStyle}>Check out</button>
                )}
                {b.status !== 'cancelled' && !b.invoice_id && (
                  <button onClick={() => invoiceBooking(b)} disabled={invoicing === b.id} style={{ ...smallBtnStyle, background: 'var(--orange)', color: '#fff', border: 'none' }}>
                    {invoicing === b.id ? 'Invoicing…' : 'Generate invoice'}
                  </button>
                )}
                {b.status !== 'cancelled' && b.status !== 'checked_out' && (
                  <button onClick={() => updateStatus(b, 'cancelled')} style={{ ...smallBtnStyle, color: 'var(--danger)' }}>Cancel</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <NewBookingForm
          business={business}
          rooms={rooms}
          customers={customers}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
    </DashboardShell>
  );
}

function NewBookingForm({ business, rooms, customers, onClose, onSaved }) {
  const supabase = createClient();
  const [roomId, setRoomId] = useState(rooms[0]?.id || '');
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [checkIn, setCheckIn] = useState(new Date().toISOString().slice(0, 10));
  const [checkOut, setCheckOut] = useState('');
  const [overlapWarning, setOverlapWarning] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const matchingCustomers = customers.filter((c) =>
    customerSearch && c.name.toLowerCase().includes(customerSearch.toLowerCase())
  ).slice(0, 6);

  function pickCustomer(c) {
    setCustomerId(c.id);
    setCustomerSearch(c.name);
    setGuestName(c.name);
    setGuestPhone(c.phone || '');
  }

  async function checkOverlap() {
    if (!roomId || !checkIn || !checkOut) return;
    setOverlapWarning('');
    const { data } = await supabase
      .from('hotel_bookings')
      .select('id, guest_name, check_in, check_out')
      .eq('room_id', roomId)
      .neq('status', 'cancelled')
      .lt('check_in', checkOut)
      .gt('check_out', checkIn);
    if (data && data.length > 0) {
      setOverlapWarning(`This room is already booked for part of that range (${data[0].guest_name}, ${data[0].check_in} to ${data[0].check_out}). You can still save if you're sure.`);
    }
  }

  async function save(e) {
    e.preventDefault();
    if (!roomId || !guestName.trim() || !checkIn || !checkOut) { setError('Fill in room, guest name, and both dates.'); return; }
    if (new Date(checkOut) <= new Date(checkIn)) { setError('Check-out must be after check-in.'); return; }
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('hotel_bookings').insert({
      business_id: business.id,
      room_id: roomId,
      customer_id: customerId || null,
      guest_name: guestName.trim(),
      guest_phone: guestPhone || null,
      check_in: checkIn,
      check_out: checkOut,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50, overflowY: 'auto' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 22, maxWidth: 420, width: '100%', margin: '20px 0' }}>
        <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--heading)', marginTop: 0 }}>New booking</h3>
        {rooms.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 13.5 }}>Add a room first, on the Rooms page.</p>
        ) : (
          <form onSubmit={save}>
            <label style={labelStyle}>Room</label>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} onBlur={checkOverlap} style={inputStyle}>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name} — {formatNaira(r.rate_per_night)}/night</option>)}
            </select>

            <label style={labelStyle}>Guest</label>
            <input placeholder="Search existing customers…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} style={inputStyle} />
            {matchingCustomers.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginTop: -8, marginBottom: 10 }}>
                {matchingCustomers.map((c) => (
                  <div key={c.id} onClick={() => pickCustomer(c)} style={{ padding: '8px 10px', fontSize: 13, cursor: 'pointer', background: customerId === c.id ? 'var(--orange-bg)' : 'transparent' }}>
                    {c.name} {c.phone ? `· ${c.phone}` : ''}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="Guest name" value={guestName} onChange={(e) => setGuestName(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
              <input placeholder="Phone" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Check-in</label>
                <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} onBlur={checkOverlap} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Check-out</label>
                <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} onBlur={checkOverlap} style={inputStyle} />
              </div>
            </div>

            {overlapWarning && (
              <p style={{ fontSize: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '8px 10px', borderRadius: 6, marginTop: -2, marginBottom: 12 }}>
                ⚠ {overlapWarning}
              </p>
            )}
            {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button type="submit" disabled={saving} style={{ background: 'var(--orange)', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Saving…' : 'Create booking'}
              </button>
              <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 18px', borderRadius: 6, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const smallBtnStyle = { background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 11.5, cursor: 'pointer', color: 'var(--text)' };
const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4, marginTop: 10 };
const inputStyle = { width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, marginBottom: 6, boxSizing: 'border-box' };
