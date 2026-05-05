# Traila Dashboard — Bordeaux

A web dashboard for visualizing processed Smart Box log sessions: GPS
track on a map, IMU traces, and broadband + per-band noise levels. Built
for the Bordeaux tram lubrication study but applicable to any Smart Box
deployment producing the same `track_metrics.csv` + `metadata.json`
pipeline output.

## What it does

- **Trips list** — every uploaded log session, sorted by upload date.
- **Trip dashboard** — one trip at a time:
  - Map of the GPS track, colored by squealing-band intensity (or
    broadband noise if the squealing band isn't present).
  - Speed and altitude over distance.
  - Acceleration (ax, ay, az, |a|) over distance.
  - Noise — broadband plus every band defined in the metadata.
  - Trip metadata, sampling rate, audio-processing settings, and band
    definitions in the left panel.
- **Upload page** (admin only) — drop a `track_metrics.csv` and a
  `metadata.json`, the rest is automatic.
- **Magic-link auth** via Supabase, with a two-tier role system: admins
  upload, viewers read.

## Architecture

```
┌───────────────┐         ┌──────────────────┐         ┌──────────────┐
│  Smart Box    │  raw    │  Python pipeline │ CSV +   │   Dashboard  │
│  (SD card)    │ ──────> │  (offline)       │ ──────> │  (this repo) │
└───────────────┘         └──────────────────┘  JSON   └──────┬───────┘
                                                              │
                                                              v
                                                       ┌──────────────┐
                                                       │   Supabase   │
                                                       │  (Postgres + │
                                                       │   auth)      │
                                                       └──────────────┘
```

The dashboard is a Next.js 14 app deployed on Vercel. It reads from and
writes to Supabase. The data pipeline that produces the upload files
lives in a separate repository (the Bordeaux pipeline) — see "Data
pipeline" below.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, CSS Modules |
| Map | Leaflet 1.9 + OpenStreetMap tiles |
| Charts | Chart.js 4 |
| CSV parsing | Papaparse 5 |
| Backend | Next.js Route Handlers (Node runtime) |
| Database | Supabase (Postgres + PostGIS + Auth + Row Level Security) |
| Hosting | Vercel |

No Python is required to run the dashboard. Python only appears in the
upstream data pipeline that produces the upload files.

## Data model

One row per upload session in `trips`. One row per sample (≈1 Hz) in
`track_metrics`. The well-known columns from the pipeline have their
own typed columns; everything else (`noise_band_1..N` and any future
signals) lands in a JSONB `extra` field. New columns flow through
end-to-end without schema changes.

```
trips                       track_metrics
─────                       ─────────────
id              uuid PK     trip_id       uuid FK
owner_id        uuid        seq           int       (0-based row index)
name            text        ts            bigint    (device µs)
notes           text        lat, lon      double
session         text        altitude_m    double
recorded_on     date        speed_kmh     double
ts_start_us     bigint      ax, ay, az    double
ts_end_us       bigint      gx, gy, gz    double
duration_s      double      acc_mag       double
n_rows          int         gyro_mag      double
metadata        jsonb       noise_db      double
created_at      timestamptz extra         jsonb     (noise_band_*, etc.)
```

The verbatim `metadata.json` is stored in `trips.metadata`. The
dashboard reads it at render time for band names, frequency ranges,
audio-processing settings, etc.

## Project structure

```
app/
  (app)/                    Authenticated routes share a header/nav
    layout.tsx
    trips/
      page.tsx              Trips list
      [id]/
        page.tsx            Trip detail (server: loads trip row)
        TripDashboard.tsx   Client: shell + lib loaders + render trigger
        dashboard.module.css
    upload/page.tsx         Admin-only upload page
  api/
    auth/callback/          Magic-link callback
    auth/logout/
    trips/[id]/metrics/     GET — returns metrics column-oriented
    upload/                 POST — chunked ingest, admin only
  login/                    Magic-link form (Suspense-wrapped)
  layout.tsx, page.tsx, globals.css

components/
  AppNav.tsx
  MetadataPanel.tsx         Left panel: trip info from metadata.json
  UploadForm.tsx            Papaparse + chunked POST

lib/
  auth.ts                   getCurrentUser, getUserRole helpers
  dashboard-render.ts       Map + plot renderer (extension points)
  supabase-server.ts        Server + admin Supabase clients
  supabase-browser.ts
  types.ts

middleware.ts               Auth gate, session cookie refresh
supabase/
  migrations/0001_init.sql  Schema, RLS, role trigger
  seed-admin.sql            Promote a user to admin
```

## Adding a new plot

The renderer is a small registry, not a monolith. To add a plot:

1. Add a `<canvas id="chartXxx" />` inside `styles.charts` in
   `app/(app)/trips/[id]/TripDashboard.tsx`.
2. Append a `{ canvasId, build }` entry to `PLOT_REGISTRY` in
   `lib/dashboard-render.ts`. The `build` function gets a `DataView`
   that returns NaNs for missing columns, so plots silently degrade
   instead of crashing.

Example for a battery-voltage trace, given the pipeline now writes
`battery_v` into `track_metrics.csv`:

```ts
{
  canvasId: "chartBattery",
  build: ({ view, distanceKm, decimateTo }) => {
    if (!view.has("battery_v")) return null;
    const xs = decimate(distanceKm, decimateTo);
    return {
      type: "line",
      data: { datasets: [{
        label: "Battery (V)",
        data: decimate(view.col("battery_v"), decimateTo)
                .map((y, i) => ({ x: xs[i], y })),
        borderColor: "#67ad7f",
        borderWidth: 1.4,
        pointRadius: 0,
      }]},
      options: CHART_COMMON,
    };
  },
},
```

No SQL change is needed because `battery_v` automatically lands in the
JSONB `extra` field on upload.

To change the map's track-coloring source, edit `ACTIVE_OVERLAY` in the
same file.

---

## Deployment from scratch

These steps assume you're starting with nothing — no Supabase project,
no Vercel project. If you already have those for an earlier branch and
just want to redeploy this code to *the same* infrastructure, skip the
new-project parts.

### Prerequisites

- Node.js ≥ 18.18 (Next 14 requires this)
- npm (bundled with Node) or pnpm
- A GitHub account (Vercel deploys from Git)
- A Supabase account (free tier is enough)
- A Vercel account (free tier is enough)

### 1. Create the Supabase project

1. Go to <https://supabase.com> → **New project**.
2. Name it (e.g. `traila-bordeaux`), choose region **Frankfurt
   (eu-central-1)**. The region is permanent, so don't get this wrong.
3. Set a strong database password and store it in your password
   manager.
4. Wait for the project to provision (~2 min).
5. Open **SQL Editor**, paste the entire contents of
   `supabase/migrations/0001_init.sql`, run it. You should see "Success.
   No rows returned." It enables PostGIS, creates the `profiles`,
   `trips`, and `track_metrics` tables, sets up Row Level Security
   policies, and installs the trigger that auto-creates a profile when
   a new auth user is created.
6. From **Settings → API**, copy three values for later:
   - **Project URL**
   - **anon public key**
   - **service_role secret** (treat this like a password)

### 2. Push the code to GitHub

```bash
unzip traila-dashboard-bordeaux.zip
cd traila-dashboard-bordeaux
git init
git add .
git commit -m "Initial Bordeaux dashboard"
git branch -M main
git remote add origin git@github.com:<your-org>/<your-repo>.git
git push -u origin main
```

### 3. Deploy to Vercel

1. <https://vercel.com> → **Add New… → Project** → import your repo.
2. Framework preset: **Next.js** (auto-detected). Don't override the
   build command.
3. Under **Environment Variables**, add three:
   - `NEXT_PUBLIC_SUPABASE_URL` = the project URL from step 1.6
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the anon key from step 1.6
   - `SUPABASE_SERVICE_ROLE_KEY` = the service_role secret. **Never**
     prefix this with `NEXT_PUBLIC_`; that would expose it to the
     browser.
4. **Deploy**. The first build takes ~1 min. You'll get a URL like
   `https://traila-dashboard-bordeaux.vercel.app`.

### 4. Wire Supabase auth redirects

Magic-link auth needs to know which URLs are safe to redirect to after
login. In Supabase:

1. **Authentication → URL Configuration**.
2. **Site URL**: your Vercel production URL.
3. **Redirect URLs**: add both
   - `https://your-vercel-url.vercel.app/**`
   - `https://*-your-team.vercel.app/**` (covers preview deployments)
   - `http://localhost:3000/**` (for local dev)

Save. Without this, login appears to succeed but the session cookie
fails to set and you bounce back to `/login`.

### 5. Create the first admin user

Supabase auto-creates every new user as a `viewer`. You promote them to
`admin` manually.

1. **Authentication → Users → Add user → Create new user**. Tick "Auto
   Confirm User" so you can skip email verification.
2. Visit your Vercel URL, sign in once with that email (this triggers
   the profile-row creation).
3. Back in **SQL Editor**, run:

```sql
update public.profiles
   set role = 'admin'
 where email = 'you@example.com';
```

4. Sign out and back in. The `Upload` link should appear in the nav.

### 6. Upload your first trip

1. Click **Upload**.
2. Give the trip a name and (optionally) notes.
3. Pick a `track_metrics.csv` and a `metadata.json` from a processed
   log session.
4. Submit. The form parses the CSV in the browser via Papaparse and
   POSTs in 4000-row chunks to keep payloads under Vercel's 4.5 MB
   serverless function limit. For a typical 3,500-row session this
   takes a few seconds.

---

## Local development

```bash
unzip traila-dashboard-bordeaux.zip
cd traila-dashboard-bordeaux
cp .env.example .env.local
# Edit .env.local with the three values from Supabase Settings → API
npm install
npm run dev
```

Open <http://localhost:3000>. The dev server hot-reloads on every save.
Make sure `http://localhost:3000/**` is in the Supabase redirect allow-
list (step 4 above) or magic-link login won't complete.

To run a production build locally (catches errors that only appear on
Vercel):

```bash
npm run build
npm start
```

---

## Data pipeline (upstream)

The dashboard expects two files per session, produced by a Python
pipeline that lives in a separate repo (`bordeaux-tram-lube-dashboard`
or whatever it's currently called). This pipeline is **not** part of
this project, but documenting it here so the chain is traceable.

The pipeline reads raw Smart Box logs (audio FLAC + IMU + GPS NMEA +
timesync) and produces a `processed/` directory containing:

- `track_metrics.csv` — one row per ~1 s window: GPS, IMU averages,
  broadband noise level (dBFS), and per-band noise levels computed
  from a Hann-windowed STFT of the audio.
- `metadata.json` — session metadata, sampling rate, audio-processing
  parameters, and the per-band frequency definitions.

The `visualize_processed_data.ipynb` notebook in that repo gives an
offline view of the same data the dashboard renders, useful for
sanity-checking new sessions before upload.

### Python packages used by the pipeline / notebook

If you need to reproduce or extend the pipeline locally, these are the
packages the notebook uses:

```
pandas
numpy
scipy
matplotlib
folium
ipywidgets
jupyter
```

The pipeline itself additionally uses (from memory of the Smart Box
processing code):

```
soundfile           # FLAC reading
librosa             # spectrograms (or scipy.signal.spectrogram if not)
```

A typical setup:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install pandas numpy scipy matplotlib folium ipywidgets jupyter \
            soundfile librosa
jupyter lab
```

If the pipeline repo has its own `requirements.txt` or `pyproject.toml`,
prefer that — the list above is a fallback.

---

## Troubleshooting

**Login succeeds but I bounce back to `/login`.**
The session cookie isn't being set. Almost always: the Vercel URL isn't
in Supabase's redirect allow-list. Re-check step 4.

**`/trips` errors with "relation `trips` does not exist".**
The migration didn't run. Open Supabase SQL Editor, paste
`supabase/migrations/0001_init.sql`, run it.

**I get a 403 from `/api/upload`.**
Your user has the `viewer` role. Run the `update profiles set role =
'admin'` statement from step 5.

**The dashboard renders an empty map and no charts.**
Open the browser console. Most common cause: the metrics endpoint
returned an empty `rows` array, which means the `track_metrics` insert
silently failed during upload (often because of a column mismatch in
the CSV). Re-upload — the upload route deletes the orphan trip row on
metric-insert failure now, but older orphans may need manual cleanup
via SQL.

**Vercel build fails with TypeScript errors.**
Run `npx tsc --noEmit` locally before pushing — Vercel uses strict
mode and will reject anything that fails locally.

**Cold-start latency.**
First request after idle takes 1–3 s. Warm requests are <100 ms. This
is Vercel serverless behavior and not specific to this app.
