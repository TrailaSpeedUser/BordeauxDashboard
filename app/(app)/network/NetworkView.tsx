"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import styles from "./network.module.css";
import { colormapJet, percentile } from "@/lib/visual-helpers";

type Cell = {
  lat: number;
  lon: number;
  n_samples: number;
  p95: number;
};

type Summary = {
  n_trips: number | null;
  n_samples_in_cells: number;
  n_cells: number;
};

type AggResponse = {
  band: string;
  cells: Cell[];
  summary: Summary;
};

type Status =
  | { kind: "loading" }
  | { kind: "ready"; data: AggResponse }
  | { kind: "empty" }
  | { kind: "error"; message: string };

const BAND_OPTIONS: { column: string; name: string; range: string }[] = [
  { column: "noise_db",     name: "Broadband",  range: "all" },
  { column: "noise_band_1", name: "Impact",     range: "20–100 Hz" },
  { column: "noise_band_2", name: "Rolling",    range: "80–200 Hz" },
  { column: "noise_band_3", name: "Flanging",   range: "2000–5000 Hz" },
  { column: "noise_band_4", name: "Squealing",  range: "5000–7000 Hz" },
];

export function NetworkView() {
  const [band, setBand] = useState("noise_band_4");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [libsReady, setLibsReady] = useState(() => {
    if (typeof window === "undefined") return { leaflet: false };
    return { leaflet: !!(window as any).L };
  });

  const mapRef = useRef<any>(null);
  const cellsLayerRef = useRef<any>(null);
  const renderedFirstRef = useRef(false);

  // ── Fetch on band change ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    fetch(`/api/aggregate?band=${encodeURIComponent(band)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((data: AggResponse) => {
        if (cancelled) return;
        if (!data.cells || data.cells.length === 0) {
          setStatus({ kind: "empty" });
        } else {
          setStatus({ kind: "ready", data });
        }
      })
      .catch((e) => {
        if (!cancelled) setStatus({ kind: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [band]);

  // ── Init map once Leaflet is loaded ───────────────────────────────
  useEffect(() => {
    if (!libsReady.leaflet || mapRef.current) return;
    const L = (window as any).L;
    const el = document.getElementById("network-map");
    if (!el) return;

    const map = L.map(el, {
      zoomControl: true,
      attributionControl: false,
    }).setView([44.8378, -0.5792], 13); // Bordeaux center as a fallback

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
      crossOrigin: true,
    }).addTo(map);

    cellsLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Settle the size after layout
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        try { map.invalidateSize(); } catch { /* noop */ }
      }),
    );
    const ro = new ResizeObserver(() => {
      try { map.invalidateSize(); } catch { /* noop */ }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      try { map.remove(); } catch { /* noop */ }
      mapRef.current = null;
      cellsLayerRef.current = null;
    };
  }, [libsReady.leaflet]);

  // ── Render cells when data lands ──────────────────────────────────
  useEffect(() => {
    const L = (window as any).L;
    const map = mapRef.current;
    const layer = cellsLayerRef.current;
    if (!L || !map || !layer || status.kind !== "ready") return;

    layer.clearLayers();
    const cells = status.data.cells;
    const p95s = cells.map((c) => c.p95);
    const lo = percentile(p95s, 0.05);
    const hi = percentile(p95s, 0.95);
    const range = hi - lo || 1;

    // Sample-count drives marker radius. Use a sqrt scale so a cell with
    // 100 samples isn't 100× the area of a 1-sample cell.
    const maxN = cells.reduce((m, c) => Math.max(m, c.n_samples), 1);
    const radiusFor = (n: number) => 4 + Math.sqrt(n / maxN) * 8; // 4–12 px

    const bounds = L.latLngBounds([]);
    for (const c of cells) {
      const t = isNaN(c.p95) ? 0 : (c.p95 - lo) / range;
      const m = L.circleMarker([c.lat, c.lon], {
        radius: radiusFor(c.n_samples),
        color: "rgba(31,29,26,0.6)",
        weight: 1,
        fillColor: colormapJet(t),
        fillOpacity: 0.85,
      });
      m.bindTooltip(
        `<div style="font-size:11px;line-height:1.4">
           <strong>${bandLabel(status.data.band)}</strong><br>
           ${c.p95.toFixed(1)} dBFS (P95)<br>
           <span style="opacity:.7">${c.n_samples} samples</span>
         </div>`,
        { sticky: true, direction: "top", opacity: 0.95 },
      );
      m.addTo(layer);
      bounds.extend([c.lat, c.lon]);
    }

    if (cells.length > 0 && bounds.isValid()) {
      // Fit bounds only on first successful render so band changes
      // don't re-zoom the user.
      if (!renderedFirstRef.current) {
        map.fitBounds(bounds, { padding: [40, 40] });
        renderedFirstRef.current = true;
      }
    }

    // Update legend values
    const lo$ = document.getElementById("net-legend-lo");
    const hi$ = document.getElementById("net-legend-hi");
    const title$ = document.getElementById("net-legend-title");
    if (lo$) lo$.textContent = isNaN(lo) ? "—" : lo.toFixed(1);
    if (hi$) hi$.textContent = isNaN(hi) ? "—" : hi.toFixed(1);
    if (title$) title$.textContent = `${bandLabel(status.data.band)} (dBFS · P95)`;
  }, [status]);

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />
      <Script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
        crossOrigin=""
        onLoad={() => setLibsReady({ leaflet: true })}
        strategy="afterInteractive"
      />

      <div className={styles.shell}>
        <div className={styles.wrap}>
          {/* ============ Left panel ============ */}
          <aside className={`${styles.panel} ${styles.left}`}>
            <div className={styles.section}>
              <div className={styles.title}>Network heatmap</div>
              <div className={styles.subtitle}>
                P95 noise across all uploaded trips, binned to ~11&nbsp;m cells.
                Color = severity, marker size = sample count.
              </div>
            </div>

            <div className={styles.section}>
              <h2>Band</h2>
              <div className={styles.bandStrip}>
                {BAND_OPTIONS.map((b) => (
                  <button
                    key={b.column}
                    type="button"
                    className={`${styles.bandBtn} ${
                      band === b.column ? styles.bandBtnActive : ""
                    }`}
                    onClick={() => setBand(b.column)}
                    title={b.range ? `${b.name} (${b.range})` : b.name}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
              <div className={styles.helper}>
                Cells with fewer than 2 samples are hidden.
              </div>
            </div>

            <div className={styles.section}>
              <h2>Coverage</h2>
              {status.kind === "ready" ? (
                <div className={styles.kv}>
                  <div className={styles.card}>
                    <div className={styles.k}>Trips</div>
                    <div className={styles.v}>
                      {status.data.summary.n_trips ?? "—"}
                    </div>
                  </div>
                  <div className={styles.card}>
                    <div className={styles.k}>Cells</div>
                    <div className={styles.v}>
                      {status.data.summary.n_cells.toLocaleString("en-US")}
                    </div>
                  </div>
                  <div className={styles.card} style={{ gridColumn: "span 2" }}>
                    <div className={styles.k}>Samples in cells</div>
                    <div className={styles.v}>
                      {status.data.summary.n_samples_in_cells.toLocaleString(
                        "en-US",
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.helper}>—</div>
              )}
            </div>

            <div className={styles.section}>
              <h2>Filters</h2>
              <div className={styles.helper}>
                Date range, speed range, time-of-day, and bounding-box filters
                will land here as more data accumulates.
              </div>
            </div>
          </aside>

          {/* ============ Map ============ */}
          <section className={`${styles.panel} ${styles.right}`}>
            <div className={styles.mapHost}>
              <div id="network-map" />
            </div>

            <div className={styles.legend}>
              <div id="net-legend-title" className={styles.helper}>
                {bandLabel(band)} (dBFS · P95)
              </div>
              <div className={styles.legendBar} />
              <div className={styles.legendTicks}>
                <span id="net-legend-lo">—</span>
                <span id="net-legend-hi">—</span>
              </div>
              <div className={styles.helper} style={{ marginTop: 4 }}>
                5–95th percentile range
              </div>
            </div>

            {status.kind === "loading" && (
              <div className={styles.statusOverlay}>Loading network data…</div>
            )}
            {status.kind === "empty" && (
              <div className={styles.statusOverlay}>
                <div className={styles.empty}>
                  No cells to show.
                  <br />
                  Either no trips have been uploaded yet, or every cell has
                  fewer than 2 samples.
                </div>
              </div>
            )}
            {status.kind === "error" && (
              <div className={styles.errorOverlay}>
                Failed to load aggregation: {status.message}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function bandLabel(col: string): string {
  const found = BAND_OPTIONS.find((b) => b.column === col);
  return found ? found.name : col;
}
