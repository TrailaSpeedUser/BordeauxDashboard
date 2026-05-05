-- =====================================================================
-- Traila Dashboard — Bordeaux branch — Initial Schema
-- =====================================================================
-- Run this on a SEPARATE Supabase project (or after wiping the existing
-- one). The tables/columns are different from the Zurich branch — see
-- README for migration notes.
--
-- Key design choice: a single flat `track_metrics` table holds one row
-- per sample. Common columns (lat/lon/IMU/broadband noise) are typed.
-- Anything beyond that — including all noise_band_N — goes into a
-- JSONB `extra` column, so adding new bands or new derived signals
-- requires no schema change.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
create extension if not exists postgis;
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- Profiles + role system (unchanged from Zurich branch)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'viewer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any existing auth users that don't have a profile yet
insert into public.profiles (id, email, role)
select id, email, 'viewer'
from auth.users
where id not in (select id from public.profiles)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------
-- One row per upload session. `metadata` is the verbatim metadata.json
-- contents — column descriptions, audio_processing settings, noise band
-- definitions, anything the producer wants to attach. The dashboard
-- reads it at render time, so changes there don't need a schema change.
-- ---------------------------------------------------------------------
create table if not exists public.trips (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- User-supplied identification
  name text not null,
  notes text,

  -- Mirrored from metadata.session for fast listing/filtering later
  session text,

  -- Recording window — derived from the data on insert
  recorded_on date,
  ts_start_us bigint,            -- device monotonic timestamp (µs)
  ts_end_us   bigint,
  duration_s  double precision,
  n_rows      integer,

  -- Bounding box for the trips list map preview (optional, computed)
  bbox geometry(Polygon, 4326),

  -- Verbatim metadata.json — column descriptions, band definitions, etc.
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists trips_owner_idx       on public.trips(owner_id);
create index if not exists trips_created_idx     on public.trips(created_at desc);
create index if not exists trips_recorded_idx    on public.trips(recorded_on desc);

-- ---------------------------------------------------------------------
-- Track metrics
-- ---------------------------------------------------------------------
-- One row per sample. The well-known columns from the Bordeaux pipeline
-- are typed; everything else (noise_band_*, future signals) lands in
-- `extra` as JSONB. Rows for the same trip should be inserted in
-- timestamp order — `seq` preserves that order for fast range queries.
-- ---------------------------------------------------------------------
create table if not exists public.track_metrics (
  trip_id uuid not null references public.trips(id) on delete cascade,
  seq     integer not null,                       -- 0-based row index
  ts      bigint  not null,                       -- device monotonic, µs

  -- GPS
  lat         double precision,
  lon         double precision,
  altitude_m  double precision,
  speed_kmh   double precision,

  -- IMU
  ax double precision, ay double precision, az double precision,
  gx double precision, gy double precision, gz double precision,
  acc_mag  double precision,
  gyro_mag double precision,

  -- Broadband noise
  noise_db double precision,

  -- Everything else — noise_band_1..N and any new columns
  extra jsonb not null default '{}'::jsonb,

  primary key (trip_id, seq)
);

create index if not exists track_metrics_trip_ts_idx
  on public.track_metrics(trip_id, ts);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.trips         enable row level security;
alter table public.track_metrics enable row level security;

-- Profiles: each user sees their own row
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (auth.uid() = id);

-- Trips: any authenticated user can read all trips, only admins can write
drop policy if exists trips_read on public.trips;
create policy trips_read on public.trips
  for select using (auth.role() = 'authenticated');

drop policy if exists trips_write on public.trips;
create policy trips_write on public.trips
  for all
  using (
    exists (select 1 from public.profiles
            where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles
            where id = auth.uid() and role = 'admin')
  );

-- Track metrics: same rule (read = authenticated, write = admin)
drop policy if exists track_metrics_read on public.track_metrics;
create policy track_metrics_read on public.track_metrics
  for select using (auth.role() = 'authenticated');

drop policy if exists track_metrics_write on public.track_metrics;
create policy track_metrics_write on public.track_metrics
  for all
  using (
    exists (select 1 from public.profiles
            where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles
            where id = auth.uid() and role = 'admin')
  );
