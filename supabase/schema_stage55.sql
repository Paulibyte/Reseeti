-- Stage 55 migration: run in the Supabase SQL editor after schema_stage54.
--
-- Phase 4, second vertical — Hotel billing. Same speculative-build
-- caveat as Construction (schema_stage54.sql) — no specific real hotel
-- validating this workflow, scoped deliberately lean: rooms + bookings
-- + invoice generation, not a full property-management system (no
-- housekeeping status, no room-service line items, no seasonal
-- pricing). The one genuinely hotel-specific thing worth building from
-- day one is availability overlap checking — two bookings can't
-- legitimately double-book the same room for overlapping dates, and
-- that check is cheap to get right now versus expensive to retrofit
-- once bookings exist without it.
create table if not exists hotel_rooms (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  name text not null,
  room_type text,
  rate_per_night numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists hotel_bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  room_id uuid references hotel_rooms(id) on delete cascade not null,
  customer_id uuid references customers(id) on delete set null,
  guest_name text not null,
  guest_phone text,
  check_in date not null,
  check_out date not null check (check_out > check_in),
  status text not null default 'booked' check (status in ('booked', 'checked_in', 'checked_out', 'cancelled')),
  invoice_id uuid references invoices(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Powers the overlap check at booking-creation time — cancelled
-- bookings are excluded since a cancelled booking shouldn't block a
-- new one for the same dates.
create index if not exists idx_hotel_bookings_room_dates
  on hotel_bookings(room_id, check_in, check_out) where status != 'cancelled';

alter table hotel_rooms enable row level security;
alter table hotel_bookings enable row level security;

create policy "Members manage hotel rooms" on hotel_rooms for all
  using (business_id in (select my_active_business_ids()))
  with check (business_id in (select my_active_business_ids()));

create policy "Members manage hotel bookings" on hotel_bookings for all
  using (business_id in (select my_active_business_ids()))
  with check (business_id in (select my_active_business_ids()));
