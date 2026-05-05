"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import styles from "./dashboard.module.css";
import { renderDashboard } from "@/lib/dashboard-render";
import type { Trip, MetricsResponse } from "@/lib/types";
import { MetadataPanel } from "@/components/MetadataPanel";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; data: MetricsResponse }
  | { kind: "error"; message: string };

export function TripDashboard({ trip }: { trip: Trip }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [libsReady, setLibsReady] = useState({ leaflet: false, chart: false });
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
            {/*
              Reserved for future controls / panels.
              Add new <section className={styles.section}> blocks below
              and wire them from lib/dashboard-render.ts.
            */}
          </aside>

          {/* ============= RIGHT PANEL — map + plots ============= */}
          <section className={`${styles.panel} ${styles.right}`}>
            <div className={styles.mapwrap}>
              <div id="map" />
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

            <div className={styles.charts}>
              <div className={styles.chartBox}>
                <div className={styles.chartTitle}>Speed &amp; altitude (over distance)</div>
                <canvas id="chartSpeed" />
              </div>
              <div className={styles.chartBox}>
                <div className={styles.chartTitle}>Acceleration / gyroscope</div>
                <canvas id="chartImu" />
              </div>
              <div className={styles.chartBox}>
                <div className={styles.chartTitle}>Noise — broadband &amp; bands</div>
                <canvas id="chartNoise" />
              </div>
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
