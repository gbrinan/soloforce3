-- Booking app schema — run ONCE on a fresh Supabase project.
-- Supabase Dashboard → SQL Editor → paste & Run,
-- or: supabase db execute -f migrations/booking.sql
--
-- Storage model: each table holds an `id` primary key + a `data` jsonb blob.
-- RLS is enabled; the app's server routes use the service_role key, which
-- bypasses RLS. Never expose the service_role key to the browser.

create table if not exists public.bookings (
  id uuid primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.bookings enable row level security;

create table if not exists public.booking_event_types (
  id uuid primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.booking_event_types enable row level security;

create table if not exists public.booking_availability (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.booking_availability enable row level security;

-- Default availability so the app works out of the box (edit later in /admin).
insert into public.booking_availability (id, data) values
  ('singleton', '{"weeklyAvailability":{"mon":{"enabled":true,"ranges":[["09:00","18:00"]]},"tue":{"enabled":true,"ranges":[["09:00","18:00"]]},"wed":{"enabled":true,"ranges":[["09:00","18:00"]]},"thu":{"enabled":true,"ranges":[["09:00","18:00"]]},"fri":{"enabled":true,"ranges":[["09:00","18:00"]]},"sat":{"enabled":false,"ranges":[]},"sun":{"enabled":false,"ranges":[]}},"meetingDurationMin":30,"bufferMin":0,"hostName":"Host","hostTitle":""}'::jsonb)
on conflict (id) do nothing;
