"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import styles from "./dashboard.module.css";
import { renderDashboard, PLOT_TABS } from "@/lib/dashboard-render";
import type { Trip, MetricsResponse } from "@/lib/types";
import { MetadataPanel } from "@/components/MetadataPanel";
import { MapControls } from "@/components/MapControls";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; data: MetricsResponse }
  | { kind: "error"; message: string };

export function TripDashboard({ trip }: { trip: Trip }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [libsReady, setLibsReady] = useState({ leaflet: false, chart: false });
  const [activeTab, setActiveTab] = useState(PLOT_TABS[0]?.canvasId ?? "");
  const [xAxis, setXAxis] = useState<"distance" | "time">("distance");
  const [timeAvailable, setTimeAvailable] = useState(false);
  const renderedRef = useRef(false);

  // Fetch metrics
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/trips/${trip.id}/metrics`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((data: MetricsResponse) => {
        if (!cancelled) setStatus({ kind: "ready", data });
      })
      .catch((e) => {
        if (!cancelled) setStatus({ kind: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [trip.id]);

  // Once both libs are loaded AND data is ready, render the visuals
  useEffect(() => {
    if (
      !libsReady.leaflet ||
      !libsReady.chart ||
      status.kind !== "ready" ||
      renderedRef.current
    ) {
      return;
    }
    renderedRef.current = true;
    try {
      renderDashboard(status.data, trip);
    } catch (e) {
      console.error("Dashboard render failed:", e);
    }
  }, [libsReady, status, trip]);

  // When the user switches tab, the previously hidden canvas was
  // display:none → its parent had no size → Chart.js's last layout
  // calculation for it is stale. Calling resize() once it's visible
  // forces a clean re-layout.
  useEffect(() => {
    if (!renderedRef.current) return;
    const charts = (typeof window !== "undefined"
      ? (window as any).__trailaCharts
      : null) as Record<string, any> | null;
    const ch = charts?.[activeTab];
    if (ch?.resize) {
      // Two RAFs ensures the CSS toggle has flushed and the new container
      // has a non-zero height before Chart.js measures.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          try {
            ch.resize();
          } catch {
            /* noop */
          }
        }),
      );
    }
  }, [activeTab]);

  // Discover whether the renderer found a usable datetime column. The
  // renderer publishes __trailaTimeAvailable after running. Poll for
  // up to ~6s.
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      const w = window as any;
      if (typeof w.__trailaTimeAvailable === "boolean") {
        setTimeAvailable(w.__trailaTimeAvailable);
        clearInterval(id);
      } else if (++tries > 60) {
        clearInterval(id);
      }
    }, 100);
    return () => clearInterval(id);
  }, [trip.id]);

  // Push x-axis selection to the renderer
  useEffect(() => {
    const setXAxisFn = (window as any).__trailaSetXAxis as
      | ((m: "distance" | "time") => void)
      | undefined;
    setXAxisFn?.(xAxis);
  }, [xAxis]);

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
        onLoad={() => setLibsReady((s) => ({ ...s, leaflet: true }))}
        strategy="afterInteractive"
      />
      <Script
        src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
        onLoad={() => setLibsReady((s) => ({ ...s, chart: true }))}
        strategy="afterInteractive"
      />

      <div className={styles.shell}>
        <div className={styles.wrap}>
          {/* ============= LEFT PANEL — metadata + future additions ============= */}
          <aside className={`${styles.panel} ${styles.left}`}>
            <MetadataPanel trip={trip} status={status} styles={styles} />
            <MapControls styles={styles} />
            {/*
              Reserved for future controls / panels.
              Add new <section className={styles.section}> blocks below
              and wire them from lib/dashboard-render.ts.
            */}
          </aside>

          {/* ============= RIGHT PANEL — map + tabbed plots ============= */}
          <section className={`${styles.panel} ${styles.right}`}>
            <div className={styles.mapwrap}>
              <div id="map" style={{ width: "100%", height: "100%", borderRadius: "18px 18px 0 0" }} />
              <div className={styles.legend}>
                <div id="legendTitle" className={styles.small}>
                  Track overlay
                </div>
                <div className="bar" style={{ height: 8, borderRadius: 4, margin: "6px 0", background: "linear-gradient(90deg, #2d6cb6, #4ec27d, #f3c64a, #ef7043, #c33b3b)" }} />
                <div className={styles.small} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span id="legendLo">—</span>
                  <span id="legendHi">—</span>
                </div>
                <div id="legendNote" className={styles.small} style={{ marginTop: 4 }} />
              </div>
            </div>

            {/* Tab strip + x-axis selector */}
            <div className={styles.tabsRow}>
              <div className={styles.tabs} role="tablist">
                {PLOT_TABS.map((tab) => (
                  <button
                    key={tab.canvasId}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.canvasId}
                    className={`${styles.tab} ${activeTab === tab.canvasId ? styles.tabActive : ""}`}
                    onClick={() => setActiveTab(tab.canvasId)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className={styles.xAxisSelector}>
                <span className={styles.xAxisLabel}>x-axis</span>
                <button
                  type="button"
                  className={`${styles.xAxisBtn} ${xAxis === "distance" ? styles.xAxisBtnActive : ""}`}
                  onClick={() => setXAxis("distance")}
                  title="Distance (km)"
                >
                  Distance
                </button>
                <button
                  type="button"
                  className={`${styles.xAxisBtn} ${xAxis === "time" ? styles.xAxisBtnActive : ""}`}
                  onClick={() => timeAvailable && setXAxis("time")}
                  disabled={!timeAvailable}
                  title={timeAvailable ? "Wall-clock time (UTC)" : "No datetime in this trip"}
                >
                  Time
                </button>
              </div>
            </div>

            {/* Chart panes — all mounted, only the active one is visible.
                Keeping all canvases mounted means renderDashboard() can
                wire them up once on first render; tab switches only
                toggle visibility. */}
            <div className={styles.chartPaneWrap}>
              {PLOT_TABS.map((tab) => (
                <div
                  key={tab.canvasId}
                  className={styles.chartPane}
                  style={{ display: activeTab === tab.canvasId ? "flex" : "none" }}
                >
                  <canvas id={tab.canvasId} />
                </div>
              ))}
            </div>

            {status.kind === "loading" && (
              <div className={styles.loading}>Loading trip data…</div>
            )}
            {status.kind === "error" && (
              <div className={styles.loadError}>Failed to load: {status.message}</div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
