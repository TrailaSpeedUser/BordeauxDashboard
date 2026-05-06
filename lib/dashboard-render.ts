/**
 * Dashboard renderer
 * ==================
 *
 * Responsibility: take the loaded MetricsResponse + Trip and draw the map
 * and the right-side plots. Designed to be EXTENDED, not rewritten.
 *
 * To add a new plot:
 *   1. Add a new <canvas id="chartXxx" /> in TripDashboard.tsx
 *      (inside the styles.charts container).
 *   2. Append a new entry to the PLOT_REGISTRY array below.
 *   3. Done — the renderer will pick it up automatically.
 *
 * To add a new map overlay (e.g. heat coloring by a different column):
 *   See MAP_OVERLAYS at the bottom.
 *
 * The data layer is column-oriented and tolerant of unknown columns:
 *   - Asking for a column that doesn't exist returns an array of NaNs
 *     and the plot silently degrades (no crash).
 *   - New noise_band_N columns appear automatically in the noise plot
 *     because that plot scans `columns` for the prefix.
 */

import type { MetricsResponse, Trip } from "./types";

// ---------------------------------------------------------------------------
// 1.  DATA UTILITIES
// ---------------------------------------------------------------------------

/** Wraps a column-oriented response with cheap accessors. */
class DataView {
  private idx: Record<string, number>;
  constructor(public res: MetricsResponse) {
    this.idx = {};
    res.columns.forEach((c, i) => (this.idx[c] = i));
  }
  has(col: string): boolean {
    return col in this.idx;
  }
  /** Returns NaN for missing column — callers can filter or pass through. */
  col(col: string): number[] {
    const i = this.idx[col];
    if (i === undefined) return new Array(this.res.rows.length).fill(NaN);
    return this.res.rows.map((r) => {
      const v = r[i];
      return v === null || v === undefined ? NaN : v;
    });
  }
  /** All column names matching a prefix, in declared order. */
  colsWithPrefix(prefix: string): string[] {
    return this.res.columns.filter((c) => c.startsWith(prefix));
  }
  rowCount(): number {
    return this.res.rows.length;
  }
}

/** Cumulative trapezoidal integration of speed_kmh → distance_m. */
function computeDistanceM(view: DataView): number[] {
  const tsUs = view.col("ts");
  const speedMs = view.col("speed_kmh").map((v) => (isNaN(v) ? 0 : v / 3.6));
  const dist = new Array(speedMs.length).fill(0);
  for (let i = 1; i < speedMs.length; i++) {
    const dt = (tsUs[i] - tsUs[i - 1]) / 1e6;
    dist[i] = dist[i - 1] + 0.5 * (speedMs[i] + speedMs[i - 1]) * (isNaN(dt) ? 0 : dt);
  }
  return dist;
}

/** Decimate uniformly to keep charts responsive — Chart.js struggles past ~5k. */
function decimate<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(arr[Math.floor(i * step)]);
  }
  return out;
}

/**
 * Indices into the original array that decimate() picks. Use this to map
 * a chart-data-point index back to its row in the underlying data — needed
 * for the chart-hover → map-cursor sync.
 */
function decimationIndices(originalLength: number, maxPoints: number): number[] {
  if (originalLength <= maxPoints) {
    return Array.from({ length: originalLength }, (_, i) => i);
  }
  const step = originalLength / maxPoints;
  const out: number[] = new Array(maxPoints);
  for (let i = 0; i < maxPoints; i++) out[i] = Math.floor(i * step);
  return out;
}

// ---------------------------------------------------------------------------
// 2.  PLOT REGISTRY
// ---------------------------------------------------------------------------

type XAxisMode = "distance" | "time";

type ChartCtx = {
  view: DataView;
  trip: Trip;
  /** Distance in km — preferred x for visual analysis. */
  distanceKm: number[];
  /** Wall-clock time in epoch ms — null if datetime column absent. */
  timeMs: number[] | null;
  /** Which one is currently the chart x-axis. */
  xAxisMode: XAxisMode;
  decimateTo: number;
  /**
   * Parallel array to the decimated chart data: chart-index N corresponds
   * to original row `originalIndices[N]`. Used to map chart hover events
   * back to lat/lon for the map cursor marker.
   */
  originalIndices: number[];
};

type PlotSpec = {
  canvasId: string;
  /** Tab label shown in the UI. Keep short — fits in a tab. */
  label: string;
  /** Returns a Chart.js config or null to skip (e.g. column missing). */
  build(ctx: ChartCtx): any | null;
};

const BAND_PALETTE = [
  "#5a9bd5",
  "#c98a55",
  "#67ad7f",
  "#a48ac6",
  "#e0925f",
  "#cf6b6b",
];

/** The current x array based on mode (km or epoch ms). */
function activeX(ctx: ChartCtx): number[] {
  if (ctx.xAxisMode === "time" && ctx.timeMs) return ctx.timeMs;
  return ctx.distanceKm;
}

/** X-axis Chart.js config for the active mode. */
function xAxisConfig(mode: XAxisMode): any {
  if (mode === "time") {
    return {
      type: "linear",
      ticks: {
        color: "#a59c94",
        font: { size: 10 },
        callback: (v: number) => {
          // v is epoch ms — show HH:MM
          const d = new Date(v);
          const hh = d.getUTCHours().toString().padStart(2, "0");
          const mm = d.getUTCMinutes().toString().padStart(2, "0");
          return `${hh}:${mm}`;
        },
      },
      grid: { color: "rgba(255,255,255,0.05)" },
      title: { display: true, text: "Time (UTC)", color: "#a59c94" },
    };
  }
  return {
    type: "linear",
    ticks: { color: "#a59c94", font: { size: 10 } },
    grid: { color: "rgba(255,255,255,0.05)" },
    title: { display: true, text: "Distance (km)", color: "#a59c94" },
  };
}

const Y_COMMON = {
  ticks: { color: "#a59c94", font: { size: 10 } },
  grid: { color: "rgba(255,255,255,0.05)" },
};

const CHART_COMMON: any = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  parsing: false,
  normalized: true,
  plugins: {
    legend: { labels: { color: "#a59c94", font: { size: 10 }, boxWidth: 10 } },
    tooltip: {
      mode: "index",
      intersect: false,
      callbacks: {
        // Format the tooltip header by mode
        title: (items: any[]) => {
          if (!items.length) return "";
          const mode = (window as any).__trailaXAxisMode as XAxisMode | undefined;
          const x = items[0].parsed.x;
          if (mode === "time") {
            const d = new Date(x);
            const hh = d.getUTCHours().toString().padStart(2, "0");
            const mm = d.getUTCMinutes().toString().padStart(2, "0");
            const ss = d.getUTCSeconds().toString().padStart(2, "0");
            return `${hh}:${mm}:${ss} UTC`;
          }
          return `${x.toFixed(2)} km`;
        },
      },
    },
    decimation: { enabled: true, algorithm: "min-max" },
  },
  interaction: { mode: "index", intersect: false },
};

const PLOT_REGISTRY: PlotSpec[] = [
  // ─── Speed + altitude ──────────────────────────────────────────────────────
  {
    canvasId: "chartSpeed",
    label: "Speed & altitude",
    build: (ctx) => {
      const { view, decimateTo } = ctx;
      if (!view.has("speed_kmh")) return null;
      const speed = view.col("speed_kmh");
      const alt = view.col("altitude_m");

      const xs = decimate(activeX(ctx), decimateTo);
      const ds: any[] = [
        {
          label: "Speed (km/h)",
          data: decimate(speed, decimateTo).map((y, i) => ({ x: xs[i], y })),
          borderColor: "#5a9bd5",
          backgroundColor: "rgba(90,155,213,0.10)",
          borderWidth: 1.4,
          pointRadius: 0,
          yAxisID: "y",
        },
      ];
      if (view.has("altitude_m")) {
        ds.push({
          label: "Altitude (m)",
          data: decimate(alt, decimateTo).map((y, i) => ({ x: xs[i], y })),
          borderColor: "#c98a55",
          backgroundColor: "rgba(201,138,85,0.10)",
          borderWidth: 1.4,
          pointRadius: 0,
          yAxisID: "y2",
        });
      }
      return {
        type: "line",
        data: { datasets: ds },
        options: {
          ...CHART_COMMON,
          scales: {
            x: xAxisConfig(ctx.xAxisMode),
            y:  { ...Y_COMMON, position: "left",  title: { display: true, text: "km/h", color: "#5a9bd5" } },
            y2: { ...Y_COMMON, position: "right", title: { display: true, text: "m",    color: "#c98a55" }, grid: { drawOnChartArea: false } },
          },
        },
      };
    },
  },

  // ─── Acceleration / gyro ───────────────────────────────────────────────────
  {
    canvasId: "chartImu",
    label: "Acceleration",
    build: (ctx) => {
      const { view, decimateTo } = ctx;
      const has = (c: string) => view.has(c);
      const xs = decimate(activeX(ctx), decimateTo);
      const ds: any[] = [];
      const make = (col: string, label: string, color: string, dash: number[], width: number) => {
        if (!has(col)) return;
        ds.push({
          label,
          data: decimate(view.col(col), decimateTo).map((y, i) => ({ x: xs[i], y })),
          borderColor: color,
          backgroundColor: color,
          borderWidth: width,
          borderDash: dash,
          pointRadius: 0,
        });
      };
      make("ax", "ax", "#cf6b6b", [4, 3], 0.9);
      make("ay", "ay", "#67ad7f", [4, 3], 0.9);
      make("az", "az", "#5a9bd5", [4, 3], 0.9);
      make("acc_mag", "|a|", "#f1ece4", [], 1.6);

      if (ds.length === 0) return null;
      return {
        type: "line",
        data: { datasets: ds },
        options: {
          ...CHART_COMMON,
          scales: {
            x: xAxisConfig(ctx.xAxisMode),
            y: { ...Y_COMMON, title: { display: true, text: "Acceleration (raw)", color: "#a59c94" } },
          },
        },
      };
    },
  },

  // ─── Gyroscope ─────────────────────────────────────────────────────────────
  {
    canvasId: "chartGyro",
    label: "Gyroscope",
    build: (ctx) => {
      const { view, decimateTo } = ctx;
      const has = (c: string) => view.has(c);
      const xs = decimate(activeX(ctx), decimateTo);
      const ds: any[] = [];
      const make = (col: string, label: string, color: string, dash: number[], width: number) => {
        if (!has(col)) return;
        ds.push({
          label,
          data: decimate(view.col(col), decimateTo).map((y, i) => ({ x: xs[i], y })),
          borderColor: color,
          backgroundColor: color,
          borderWidth: width,
          borderDash: dash,
          pointRadius: 0,
        });
      };
      // Warmer palette than accel so the two charts feel distinct when
      // the user toggles between them.
      make("gx", "gx", "#e0925f", [4, 3], 0.9);
      make("gy", "gy", "#a48ac6", [4, 3], 0.9);
      make("gz", "gz", "#5a9bd5", [4, 3], 0.9);
      make("gyro_mag", "|g|", "#f1ece4", [], 1.6);

      if (ds.length === 0) return null;
      return {
        type: "line",
        data: { datasets: ds },
        options: {
          ...CHART_COMMON,
          scales: {
            x: xAxisConfig(ctx.xAxisMode),
            y: { ...Y_COMMON, title: { display: true, text: "Angular rate (raw)", color: "#a59c94" } },
          },
        },
      };
    },
  },

  // ─── Noise (broadband + bands) ─────────────────────────────────────────────
  {
    canvasId: "chartNoise",
    label: "Noise",
    build: (ctx) => {
      const { view, trip, decimateTo } = ctx;
      const xs = decimate(activeX(ctx), decimateTo);
      const ds: any[] = [];
      if (view.has("noise_db")) {
        ds.push({
          label: "Broadband (dBFS)",
          data: decimate(view.col("noise_db"), decimateTo).map((y, i) => ({ x: xs[i], y })),
          borderColor: "#f1ece4",
          backgroundColor: "rgba(241,236,228,0.05)",
          borderWidth: 1.6,
          pointRadius: 0,
        });
      }
      const bands = view.colsWithPrefix("noise_band_").sort();
      const colDefs = trip.metadata?.columns ?? {};
      bands.forEach((bcol, i) => {
        const def = colDefs[bcol] ?? {};
        const name = def.name ?? bcol;
        const range = def.f_low_hz && def.f_high_hz
          ? ` (${def.f_low_hz}–${def.f_high_hz} Hz)`
          : "";
        ds.push({
          label: `${String(name).charAt(0).toUpperCase()}${String(name).slice(1)}${range}`,
          data: decimate(view.col(bcol), decimateTo).map((y, j) => ({ x: xs[j], y })),
          borderColor: BAND_PALETTE[i % BAND_PALETTE.length],
          backgroundColor: BAND_PALETTE[i % BAND_PALETTE.length],
          borderWidth: 1.2,
          pointRadius: 0,
        });
      });
      if (ds.length === 0) return null;
      return {
        type: "line",
        data: { datasets: ds },
        options: {
          ...CHART_COMMON,
          scales: {
            x: xAxisConfig(ctx.xAxisMode),
            y: { ...Y_COMMON, title: { display: true, text: "Noise (dBFS)", color: "#a59c94" } },
          },
        },
      };
    },
  },
];

/**
 * Public descriptor of the plot registry — what the UI uses to draw tabs.
 * Adding a new plot above automatically adds a tab in the dashboard.
 */
export const PLOT_TABS: { canvasId: string; label: string }[] =
  PLOT_REGISTRY.map(({ canvasId, label }) => ({ canvasId, label }));

// ---------------------------------------------------------------------------
// 3.  MAP OVERLAYS
// ---------------------------------------------------------------------------
//
// The map shows the GPS track. By default the line is colored by the
// "noise_band_4" (squealing) value if that column exists; otherwise by
// noise_db. To add another overlay, append a new MapOverlay below and set
// it as ACTIVE_OVERLAY.
//
// The colormap is fixed (blue→green→yellow→orange→red); the legend lo/hi
// values come from the column's percentile range.

type MapOverlay = {
  /** Pick the column to color by; return null to skip overlay. */
  pickColumn(view: DataView): string | null;
  /** Pretty title shown in the legend. */
  title(view: DataView, trip: Trip, column: string): string;
};

const ACTIVE_OVERLAY: MapOverlay = {
  pickColumn(view) {
    if (view.has("noise_band_4")) return "noise_band_4";
    if (view.has("noise_db")) return "noise_db";
    return null;
  },
  title(_view, trip, column) {
    const def = trip.metadata?.columns?.[column];
    const name = def?.name ?? column;
    const r = def?.f_low_hz && def?.f_high_hz
      ? ` ${def.f_low_hz}–${def.f_high_hz} Hz`
      : "";
    return `${String(name).charAt(0).toUpperCase()}${String(name).slice(1)}${r} (dBFS)`;
  },
};

function colormapJet(t: number): string {
  // 0..1 → blue → green → yellow → orange → red
  const stops: [number, [number, number, number]][] = [
    [0.0, [45, 108, 182]],
    [0.25, [78, 194, 125]],
    [0.55, [243, 198, 74]],
    [0.8, [239, 112, 67]],
    [1.0, [195, 59, 59]],
  ];
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    if (t <= t1) {
      const [t0, c0] = stops[i - 1];
      const k = (t - t0) / (t1 - t0);
      const r = c0[0] + (c1[0] - c0[0]) * k;
      const g = c0[1] + (c1[1] - c0[1]) * k;
      const b = c0[2] + (c1[2] - c0[2]) * k;
      return `rgb(${r.toFixed(0)},${g.toFixed(0)},${b.toFixed(0)})`;
    }
  }
  return "rgb(195,59,59)";
}

function percentile(values: number[], p: number): number {
  const cleaned = values.filter((v) => !isNaN(v)).sort((a, b) => a - b);
  if (cleaned.length === 0) return NaN;
  const idx = Math.min(cleaned.length - 1, Math.max(0, Math.floor(p * (cleaned.length - 1))));
  return cleaned[idx];
}

// ---------------------------------------------------------------------------
// 4.  ENTRY POINT
// ---------------------------------------------------------------------------

export function renderDashboard(data: MetricsResponse, trip: Trip) {
  if (data.rows.length === 0) {
    console.warn("No metrics rows for trip", trip.id);
    return;
  }

  // Idempotent: if a previous run left charts or a map behind (which can
  // happen on a hydration recovery or HMR), destroy them first. Otherwise
  // Leaflet refuses to re-init a container ("Map container is already
  // initialized") and Chart.js leaks.
  const w = window as any;
  if (w.__trailaCharts) {
    for (const ch of Object.values(w.__trailaCharts) as any[]) {
      try { ch?.destroy?.(); } catch { /* noop */ }
    }
    w.__trailaCharts = null;
  }
  if (w.__trailaMap) {
    try { w.__trailaMap.remove(); } catch { /* noop */ }
    w.__trailaMap = null;
  }
  // Clear cursor hook so chart hover from a previous render can't fire
  // into a destroyed map.
  w.__trailaSetCursor = null;
  w.__trailaSetXAxis = null;
  w.__trailaUpdateOverlay = null;
  w.__trailaBands = null;
  w.__trailaInitialBand = null;
  w.__trailaTimeAvailable = undefined;
  w.__trailaXAxisMode = undefined;
  w.__trailaTilesOk = false;

  const view = new DataView(data);

  // Distance: prefer the column from upstream (already integrated and
  // calibrated). Fall back to speed integration for old uploads.
  let distanceKm: number[];
  if (view.has("distance_m")) {
    const colVals = view.col("distance_m");
    // If the whole column is NaN (old upload), fall back
    const anyValid = colVals.some((v) => !isNaN(v));
    distanceKm = anyValid
      ? colVals.map((m) => (isNaN(m) ? NaN : m / 1000))
      : computeDistanceM(view).map((d) => d / 1000);
  } else {
    distanceKm = computeDistanceM(view).map((d) => d / 1000);
  }

  // Wall-clock time (epoch ms) — null if column absent or all-null
  let timeMs: number[] | null = null;
  if (view.has("datetime")) {
    const colVals = view.col("datetime");
    if (colVals.some((v) => !isNaN(v))) timeMs = colVals;
  }

  // ---- Map ----
  // @ts-ignore — Leaflet is loaded via <Script>
  const L = (window as any).L;
  if (L) {
    const lat = view.col("lat");
    const lon = view.col("lon");
    const validIdx: number[] = [];
    for (let i = 0; i < lat.length; i++) {
      if (!isNaN(lat[i]) && !isNaN(lon[i])) validIdx.push(i);
    }

    if (validIdx.length > 0) {
      const center: [number, number] = [
        lat[validIdx[Math.floor(validIdx.length / 2)]],
        lon[validIdx[Math.floor(validIdx.length / 2)]],
      ];
      const map = L.map("map", { zoomControl: true, attributionControl: false }).setView(center, 15);
      (window as any).__trailaMap = map;
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
        crossOrigin: true,
      });
      tiles.on("tileerror", (e: any) => {
        console.warn("[map] tile load error:", e?.tile?.src ?? e);
      });
      tiles.on("tileload", () => {
        if (!(window as any).__trailaTilesOk) {
          (window as any).__trailaTilesOk = true;
          console.log("[map] first tile loaded");
        }
      });
      tiles.addTo(map);

      // ── Overlay layer group: all colored segments live here, so we
      // can rebuild them on band/threshold change without rebuilding the
      // whole map.
      const overlayLayer = L.layerGroup().addTo(map);

      // Pre-compute sorted values per available band column, used for
      // percentile lookups when threshold filtering is active.
      const noiseCols = view.colsWithPrefix("noise_band_").sort();
      const allNoiseCols = (view.has("noise_db") ? ["noise_db"] : []).concat(noiseCols);
      const sortedByCol: Record<string, number[]> = {};
      for (const c of allNoiseCols) {
        sortedByCol[c] = view
          .col(c)
          .filter((v) => !isNaN(v))
          .sort((a, b) => a - b);
      }

      /**
       * Look up a value's percentile rank within its column's distribution.
       * Returns 0..1 (e.g. 0.92 means "louder than 92% of samples").
       */
      const rankIn = (sortedAsc: number[], v: number): number => {
        if (!sortedAsc.length || isNaN(v)) return 0;
        // Binary search for first index >= v
        let lo = 0, hi = sortedAsc.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (sortedAsc[mid] < v) lo = mid + 1;
          else hi = mid;
        }
        return lo / sortedAsc.length;
      };

      /**
       * Render the polyline overlay for a given band/threshold.
       * Called once at init, then again whenever the user changes controls.
       */
      function applyOverlay(bandColumn: string, percentileFloor: number) {
        overlayLayer.clearLayers();

        if (!view.has(bandColumn)) {
          // Nothing to color by — fall back to a plain track
          const pts = validIdx.map((i): [number, number] => [lat[i], lon[i]]);
          L.polyline(pts, { color: "#ed6b41", weight: 3, opacity: 0.85 })
            .addTo(overlayLayer);
          return;
        }

        const vals = view.col(bandColumn);
        const sortedAsc = sortedByCol[bandColumn] ?? [];
        const lo = percentile(vals, 0.05);
        const hi = percentile(vals, 0.95);
        const range = hi - lo || 1;

        // Pretty band name for tooltips/legend
        const colDef = trip.metadata?.columns?.[bandColumn] ?? {};
        const niceName = (() => {
          if (bandColumn === "noise_db") return "Broadband";
          const n = colDef.name ?? bandColumn;
          return String(n).charAt(0).toUpperCase() + String(n).slice(1);
        })();
        const freqRange =
          colDef.f_low_hz && colDef.f_high_hz
            ? `${colDef.f_low_hz}–${colDef.f_high_hz} Hz`
            : "";

        // Draw one segment per consecutive valid pair.
        // Below-threshold segments get faded opacity rather than hidden,
        // so the user keeps geographic context.
        for (let k = 1; k < validIdx.length; k++) {
          const a = validIdx[k - 1];
          const b = validIdx[k];
          const v = (vals[a] + vals[b]) / 2;
          const t = isNaN(v) ? 0 : (v - lo) / range;
          const rank = rankIn(sortedAsc, v);
          const aboveThreshold = rank >= percentileFloor;
          const opacity = aboveThreshold ? 0.9 : 0.18;
          const weight = aboveThreshold ? 5 : 3;

          const seg = L.polyline(
            [
              [lat[a], lon[a]],
              [lat[b], lon[b]],
            ],
            { color: colormapJet(t), weight, opacity },
          );

          // Hover tooltip — built lazily via bindTooltip with `sticky: true`
          // so it follows the cursor along the line.
          const valStr = isNaN(v) ? "—" : v.toFixed(1);
          const rankStr = isNaN(v) ? "" : `top ${((1 - rank) * 100).toFixed(0)}%`;
          seg.bindTooltip(
            `<div style="font-size:11px;line-height:1.4">
               <strong>${niceName}</strong>
               ${freqRange ? `<span style="opacity:.7"> ${freqRange}</span>` : ""}
               <br>${valStr} dBFS
               ${rankStr ? `<span style="opacity:.7"> · ${rankStr}</span>` : ""}
             </div>`,
            { sticky: true, direction: "top", opacity: 0.95 },
          );
          seg.addTo(overlayLayer);
        }

        // Legend
        const legendTitle = document.getElementById("legendTitle");
        const lo$ = document.getElementById("legendLo");
        const hi$ = document.getElementById("legendHi");
        const note = document.getElementById("legendNote");
        if (legendTitle) {
          legendTitle.textContent = `${niceName}${freqRange ? ` ${freqRange}` : ""} (dBFS)`;
        }
        if (lo$) lo$.textContent = lo.toFixed(1);
        if (hi$) hi$.textContent = hi.toFixed(1);
        if (note) {
          note.textContent =
            percentileFloor > 0
              ? `Showing top ${((1 - percentileFloor) * 100).toFixed(0)}%`
              : "5–95th percentile";
        }
      }

      // Start / end markers (drawn once, not part of overlay layer so they
      // survive overlay rebuilds)
      const start = validIdx[0];
      const end = validIdx[validIdx.length - 1];
      L.circleMarker([lat[start], lon[start]], {
        radius: 6, color: "#fff", fillColor: "#67ad7f", fillOpacity: 1, weight: 2,
      }).bindTooltip("Start").addTo(map);
      L.circleMarker([lat[end], lon[end]], {
        radius: 6, color: "#fff", fillColor: "#cf6b6b", fillOpacity: 1, weight: 2,
      }).bindTooltip("End").addTo(map);

      // ── Chart-hover cursor marker ────────────────────────────────
      // A single marker that tracks the user's chart hover position.
      // Hidden by default (zero radius); chart's onHover positions and
      // shows it, mouseleave hides it.
      const cursorMarker = L.circleMarker([0, 0], {
        radius: 0,
        color: "#1f1d1a",
        weight: 2,
        fillColor: "#f5a45c",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
      (window as any).__trailaSetCursor = (rowIdx: number | null) => {
        if (rowIdx === null || rowIdx === undefined) {
          cursorMarker.setRadius(0);
          return;
        }
        const la = lat[rowIdx];
        const lo2 = lon[rowIdx];
        if (isNaN(la) || isNaN(lo2)) {
          cursorMarker.setRadius(0);
          return;
        }
        cursorMarker.setLatLng([la, lo2]);
        cursorMarker.setRadius(8);
      };

      // Initial overlay
      const initialBand =
        ACTIVE_OVERLAY.pickColumn(view) ?? allNoiseCols[allNoiseCols.length - 1] ?? "";
      applyOverlay(initialBand, 0);

      // Expose to React: list of available bands + the update function.
      // The TripDashboard component picks these up in a useEffect after
      // the renderer has run.
      (window as any).__trailaBands = allNoiseCols.map((c) => {
        const def = trip.metadata?.columns?.[c] ?? {};
        const name =
          c === "noise_db"
            ? "Broadband"
            : (def.name ?? c).charAt(0).toUpperCase() + (def.name ?? c).slice(1);
        const range =
          def.f_low_hz && def.f_high_hz
            ? `${def.f_low_hz}–${def.f_high_hz} Hz`
            : c === "noise_db"
              ? "all"
              : "";
        return { column: c, name, range };
      });
      (window as any).__trailaUpdateOverlay = (band: string, percentileFloor: number) => {
        applyOverlay(band, percentileFloor);
      };
      (window as any).__trailaInitialBand = initialBand;

      // Fit bounds
      const bounds = L.latLngBounds(validIdx.map((i: number) => [lat[i], lon[i]]));
      map.fitBounds(bounds, { padding: [20, 20] });

      // Sizing settle (see earlier hydration discussion)
      const mapEl = document.getElementById("map");
      if (mapEl) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            map.invalidateSize();
            map.fitBounds(bounds, { padding: [20, 20] });
          }),
        );
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(mapEl);
      }
    }
  }

  // ---- Charts ----
  // @ts-ignore — Chart.js loaded via <Script>
  const Chart = (window as any).Chart;
  if (!Chart) return;

  const decimateTo = 2500;
  // Initial x-axis mode — distance is the default. Stash globally so
  // tooltip callback can read it without closing over the ctx.
  let xAxisMode: XAxisMode = "distance";
  (window as any).__trailaXAxisMode = xAxisMode;
  (window as any).__trailaTimeAvailable = timeMs !== null;

  const buildCtx = (): ChartCtx => ({
    view,
    trip,
    distanceKm,
    timeMs,
    xAxisMode,
    decimateTo,
    originalIndices: decimationIndices(distanceKm.length, decimateTo),
  });

  // ── Crosshair plugin ──────────────────────────────────────────────
  // Draws a dashed vertical line at the active tooltip's x position.
  // Reads `chart.tooltip._active` directly because that's the only
  // mechanism Chart.js exposes for "where is the cursor right now."
  const crosshairPlugin = {
    id: "trailaCrosshair",
    afterDraw: (chart: any) => {
      const active = chart.tooltip?._active;
      if (!active || active.length === 0) return;
      const x = active[0].element?.x;
      if (typeof x !== "number") return;
      const { top, bottom } = chart.chartArea;
      const c = chart.ctx;
      c.save();
      c.beginPath();
      c.setLineDash([4, 4]);
      c.lineWidth = 1;
      c.strokeStyle = "rgba(241,236,228,0.55)";
      c.moveTo(x, top);
      c.lineTo(x, bottom);
      c.stroke();
      c.restore();
    },
  };

  let chartCtx = buildCtx();

  // ── Hover handler ─────────────────────────────────────────────────
  // Maps a chart-data-point index back to an original row index and
  // pushes it to the map cursor. When the cursor leaves the chart area
  // (no active elements), hide the marker.
  const onHover = (_evt: any, elements: any[], chart: any) => {
    const setCursor = (window as any).__trailaSetCursor as
      | ((rowIdx: number | null) => void)
      | undefined;
    if (!setCursor) return;
    if (elements && elements.length > 0) {
      const i = elements[0].index;
      const orig = chartCtx.originalIndices[i];
      if (typeof orig === "number") setCursor(orig);
    } else {
      setCursor(null);
    }
    // Force redraw so the crosshair line tracks the cursor live
    chart.draw();
  };

  function buildAllCharts() {
    // Destroy existing instances (used when the x-axis mode toggles)
    const prev = (window as any).__trailaCharts as Record<string, any> | null;
    if (prev) {
      for (const c of Object.values(prev)) {
        try { (c as any)?.destroy?.(); } catch { /* noop */ }
      }
    }

    chartCtx = buildCtx();
    const charts: Record<string, any> = {};
    for (const spec of PLOT_REGISTRY) {
      const el = document.getElementById(spec.canvasId) as HTMLCanvasElement | null;
      if (!el) continue;
      const cfg = spec.build(chartCtx);
      if (!cfg) continue;
      cfg.plugins = [...(cfg.plugins ?? []), crosshairPlugin];
      cfg.options = { ...cfg.options, onHover };
      charts[spec.canvasId] = new Chart(el, cfg);
    }
    (window as any).__trailaCharts = charts;
  }

  buildAllCharts();

  // Hide cursor when leaving the chart container entirely (Chart.js's
  // onHover only fires while *over* a data area, so we need a DOM-level
  // mouseleave on the canvas to catch corner exits and gaps between
  // datasets).
  for (const spec of PLOT_REGISTRY) {
    const el = document.getElementById(spec.canvasId);
    if (!el) continue;
    el.addEventListener("mouseleave", () => {
      const setCursor = (window as any).__trailaSetCursor as
        | ((rowIdx: number | null) => void)
        | undefined;
      setCursor?.(null);
    });
  }

  // Expose x-axis switcher to the React side
  (window as any).__trailaSetXAxis = (mode: XAxisMode) => {
    if (mode === "time" && timeMs === null) return; // guard against bad input
    if (mode === xAxisMode) return;
    xAxisMode = mode;
    (window as any).__trailaXAxisMode = mode;
    buildAllCharts();
  };
}
