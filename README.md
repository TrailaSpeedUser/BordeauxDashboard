# Traila Dashboard — Bordeaux branch

This is a sibling project to the original Zurich `traila-dashboard`. Same
look-and-feel, same auth model, but a different visualization centered on the
new processed-data pipeline (`track_metrics.csv` + `metadata.json`).

## What changed vs. the Zurich branch

### Visible

| Aspect | Zurich branch | This branch |
|---|---|---|
| Left panel | Filters + playback controls + audio segments | Trip metadata + noise band definitions (info only). Reserved for additions. |
| Right panel | Map + 2 charts (mag + axes) | Map + 3 charts (speed/altitude, IMU, noise) |
| Playback / time slider | yes | **removed** |
| Filters (line, tram) | yes | **removed** |
| Audio segments | yes | not part of this pipeline |
| Map overlay | acc_mag heat | configurable; defaults to squealing band, falls back to broadband |

### Under the hood

- New schema: a single `track_metrics` table replaces the three Zurich tables
  (`gps_points`, `imu_samples`, `audio_segments`).
- Schema-flexible: typed columns for the well-known fields, JSONB `extra`
  for everything else (the `noise_band_N` columns and any future signals).
- Adding a new noise band or any new column to `track_metrics.csv` requires
  **no schema change**, **no SQL migration** — it flows through automatically.

## Supabase: do I need to delete or update the database?

**Short answer: don't touch the existing Zurich Supabase project.** Create a
new one for this branch.

**Why:** this branch's schema is incompatible with the Zurich one — different
tables, different columns. They cannot coexist on the same database without
either renaming everything (ugly and confusing) or losing the Zurich data.

**What to do:**

1. In Supabase, create a **new** project (suggest naming it
   `traila-bordeaux`). Same region as the Zurich one (Frankfurt).
2. Copy the project URL and anon/service-role keys.
3. Run `supabase/migrations/0001_init.sql` in the SQL editor of that new
   project.
4. In Vercel, create a **new project** (or use a preview branch) pointing at
   this repo and set its env vars to the new Supabase keys. The Vercel URL
   for `main` and the Supabase URL for the original Zurich project remain
   untouched.

If you really want to reuse the same Supabase project (not recommended),
you'd need to:

- Drop the old tables: `drop table gps_points, imu_samples, audio_segments,
  trips cascade;`
- Then run this branch's `0001_init.sql`.
- All Zurich trip data is lost.

The `profiles` table format is identical between the two branches, so user
accounts and admin roles can be migrated. If you reuse the project, your
existing admin user keeps their role.

## Project structure (where the magic happens)

```
app/
  (app)/
    layout.tsx              ← header + nav for authenticated routes
    trips/
      page.tsx              ← trips list
      [id]/
        page.tsx            ← trip detail (server-loads trip row)
        TripDashboard.tsx   ← client component: shell + libs + render trigger
        dashboard.module.css
    upload/page.tsx         ← admin-only upload page
  api/
    auth/...                ← magic-link callback + logout
    trips/[id]/metrics/     ← GET track_metrics rows (column-oriented)
    upload/                 ← POST chunked ingest
  login/page.tsx
  layout.tsx, page.tsx, globals.css
components/
  AppNav.tsx
  MetadataPanel.tsx         ← left side — info from trip.metadata
  UploadForm.tsx            ← Papaparse + chunked POST
lib/
  auth.ts
  dashboard-render.ts       ← THE rendering engine — see below
  supabase-server.ts, supabase-browser.ts
  types.ts
supabase/
  migrations/0001_init.sql
  seed-admin.sql
middleware.ts
```

### The renderer (`lib/dashboard-render.ts`)

This is intentionally written as a small framework rather than one big
function, because you said you want to add more plots over time. It has
three extension points:

1. **`PLOT_REGISTRY`** — array of `{ canvasId, build }` entries. Add a new
   plot by appending one entry and adding a matching `<canvas>` in
   `TripDashboard.tsx`. The `build` function gets a `DataView` that handles
   missing columns gracefully.

2. **`ACTIVE_OVERLAY`** — the function that picks which column drives the
   map track coloring. Switch to a different column or write a more
   elaborate selector here.

3. **`DataView`** — a thin wrapper that handles unknown columns (returns
   NaNs instead of crashing) and lets you ask for "all columns matching a
   prefix" for things like the noise bands.

### Adding a plot — concrete example

Say you also want to plot battery voltage. The pipeline now writes
`battery_v` into `track_metrics.csv`. Two changes, no SQL needed:

```tsx
// TripDashboard.tsx
<div className={styles.chartBox}>
  <div className={styles.chartTitle}>Battery</div>
  <canvas id="chartBattery" />
</div>
```

```ts
// lib/dashboard-render.ts → PLOT_REGISTRY
{
  canvasId: "chartBattery",
  build: ({ view, distanceKm, decimateTo }) => {
    if (!view.has("battery_v")) return null;
    const xs = decimate(distanceKm, decimateTo);
    return {
      type: "line",
      data: { datasets: [{
        label: "Battery (V)",
        data: decimate(view.col("battery_v"), decimateTo).map((y, i) => ({ x: xs[i], y })),
        borderColor: "#67ad7f", borderWidth: 1.4, pointRadius: 0,
      }]},
      options: CHART_COMMON,
    };
  },
},
```

That's it.

## Local development

```bash
cp .env.example .env.local
# fill in values from your new Supabase project
npm install
npm run dev
```

## Vercel deployment

Same flow as the Zurich branch:

1. Push to GitHub.
2. Vercel → Import → pick the repo → set the three env vars from
   `.env.example`.
3. In Supabase → Authentication → URL Configuration, add the Vercel URL
   and the wildcard `https://traila-bordeaux-*.vercel.app/**` to the
   redirect allow-list.
4. Create your first user in Supabase Authentication, log in once, then
   run `supabase/seed-admin.sql` (with your email substituted) to grant
   admin.

## Test data

Use the example files from `data/example/` — the `track_metrics.csv` and
`metadata.json` from the Bordeaux pipeline drop. The dashboard handles
~3,500 samples in roughly 600ms after data lands.
