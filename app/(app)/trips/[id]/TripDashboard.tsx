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

type ResizeKind = "sidebar" | "charts";

type ResizeDrag = {
  kind: ResizeKind;
  pointerId: number;
  startX: number;
  startY: number;
  startSize: number;
  previousCursor: string;
  previousUserSelect: string;
};

type PendingResize = {
  kind: ResizeKind;
  size: number;
};

const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 620;
const CHARTS_MIN = 180;
const CHARTS_MAX = 720;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function TripDashboard({ trip }: { trip: Trip }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  // Initialize from window in case scripts loaded on a previous visit.
  // <Script onLoad> only fires on the actual load event; if the user
  // navigates away and back, the scripts are cached but onLoad won't
  // re-fire, so we need to detect the already-loaded state ourselves.
  const [libsReady, setLibsReady] = useState(() => {
    if (typeof window === "undefined") {
      return { leaflet: false, rotate: false, chart: false };
    }
    const w = window as any;
    return {
      leaflet: !!w.L,
      rotate: typeof w.L?.Map?.prototype?.setBearing === "function",
      chart: !!w.Chart,
    };
  });
  const [activeTab, setActiveTab] = useState(PLOT_TABS[0]?.canvasId ?? "");
  const [xAxis, setXAxis] = useState<"distance" | "time">("distance");
  const [timeAvailable, setTimeAvailable] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapBearing, setMapBearing] = useState<0 | -90>(0);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [chartHeight, setChartHeight] = useState<number | null>(null);
  const [activeResize, setActiveResize] = useState<ResizeKind | null>(null);
  const renderedRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);
  const tabsRowRef = useRef<HTMLDivElement>(null);
  const chartPaneRef = useRef<HTMLDivElement>(null);
  const resizeDragRef = useRef<ResizeDrag | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<PendingResize | null>(null);

  // Fetch metrics
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/trips/${trip.id}/metrics?maxRows=12000`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((data: MetricsResponse) => {
        setStatus({ kind: "ready", data });
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setStatus({ kind: "error", message: String(e) });
      });
    return () => {
      controller.abort();
    };
  }, [trip.id]);

  // Once all visual libraries are loaded AND data is ready, render the visuals
  useEffect(() => {
    if (
      !libsReady.leaflet ||
      !libsReady.rotate ||
      !libsReady.chart ||
      status.kind !== "ready" ||
      renderedRef.current
    ) {
      return;
    }
    renderedRef.current = true;
    try {
      renderDashboard(status.data, trip);
      setMapReady(
        typeof (window as any).__trailaSetMapBearing === "function",
      );
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

  // Restore global cursor styles if navigation happens during a drag.
  useEffect(() => () => {
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    pendingResizeRef.current = null;
    const drag = resizeDragRef.current;
    if (!drag) return;
    document.body.style.cursor = drag.previousCursor;
    document.body.style.userSelect = drag.previousUserSelect;
    resizeDragRef.current = null;
  }, []);

  const toggleMapOrientation = () => {
    const setBearing = (window as any).__trailaSetMapBearing as
      | ((degrees: number) => void)
      | undefined;
    if (!setBearing) return;

    const nextBearing = mapBearing === 0 ? -90 : 0;
    setBearing(nextBearing);
    setMapBearing(nextBearing);
  };

  const sidebarMax = () => {
    const availableWidth =
      wrapRef.current?.getBoundingClientRect().width ?? SIDEBAR_MAX + 430;
    // Preserve enough room for the map and charts at narrower widths.
    return Math.max(
      SIDEBAR_MIN,
      Math.min(SIDEBAR_MAX, availableWidth - 430),
    );
  };

  const chartsMax = () => {
    const panelHeight =
      rightPanelRef.current?.getBoundingClientRect().height ?? CHARTS_MAX + 278;
    const tabsHeight = tabsRowRef.current?.getBoundingClientRect().height ?? 48;
    // Keep at least 220 px of usable map above the divider.
    return Math.max(
      CHARTS_MIN,
      Math.min(CHARTS_MAX, panelHeight - tabsHeight - 230),
    );
  };

  const startResize = (
    kind: ResizeKind,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const startSize =
      kind === "sidebar"
        ? (leftPanelRef.current?.getBoundingClientRect().width ?? sidebarWidth)
        : (chartPaneRef.current?.getBoundingClientRect().height ?? 300);

    resizeDragRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startSize,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = kind === "sidebar" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    setActiveResize(kind);
  };

  const continueResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.kind === "sidebar") {
      pendingResizeRef.current = {
        kind: "sidebar",
        size: clamp(
          drag.startSize + event.clientX - drag.startX,
          SIDEBAR_MIN,
          sidebarMax(),
        ),
      };
    } else {
      pendingResizeRef.current = {
        kind: "charts",
        size: clamp(
          drag.startSize - (event.clientY - drag.startY),
          CHARTS_MIN,
          chartsMax(),
        ),
      };
    }

    // Pointer events can arrive faster than the browser can paint. Commit at
    // most one React update per frame to keep map/chart resizing smooth.
    if (resizeFrameRef.current === null) {
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        const pending = pendingResizeRef.current;
        pendingResizeRef.current = null;
        if (!pending) return;
        if (pending.kind === "sidebar") setSidebarWidth(pending.size);
        else setChartHeight(pending.size);
      });
    }
  };

  const finishResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    const pending = pendingResizeRef.current;
    pendingResizeRef.current = null;
    if (pending?.kind === "sidebar") setSidebarWidth(pending.size);
    if (pending?.kind === "charts") setChartHeight(pending.size);
    document.body.style.cursor = drag.previousCursor;
    document.body.style.userSelect = drag.previousUserSelect;
    resizeDragRef.current = null;
    setActiveResize(null);
  };

  const resizeWithKeyboard = (
    kind: ResizeKind,
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    const step = event.shiftKey ? 40 : 16;

    if (kind === "sidebar" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      setSidebarWidth((width) =>
        clamp(width + direction * step, SIDEBAR_MIN, sidebarMax()),
      );
    }

    if (kind === "charts" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const current =
        chartHeight ?? chartPaneRef.current?.getBoundingClientRect().height ?? 300;
      const direction = event.key === "ArrowUp" ? 1 : -1;
      setChartHeight(clamp(current + direction * step, CHARTS_MIN, chartsMax()));
    }
  };

  const chartHeightStyle = chartHeight === null
    ? undefined
    : ({ "--chart-height": `${chartHeight}px` } as React.CSSProperties);

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
      {libsReady.leaflet && !libsReady.rotate && (
        <Script
          src="https://cdn.jsdelivr.net/npm/@tomickigrzegorz/leaflet-rotate@0.2.4/dist/leaflet-rotate.umd.min.js"
          onLoad={() => setLibsReady((s) => ({ ...s, rotate: true }))}
          strategy="afterInteractive"
        />
      )}
      <Script
        src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
        onLoad={() => setLibsReady((s) => ({ ...s, chart: true }))}
        strategy="afterInteractive"
      />

      <div className={styles.shell}>
        <div
          ref={wrapRef}
          className={styles.wrap}
          style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
        >
          {/* ============= LEFT PANEL — metadata + future additions ============= */}
          <aside
            ref={leftPanelRef}
            id="trip-sidebar"
            className={`${styles.panel} ${styles.left}`}
          >
            <MetadataPanel trip={trip} status={status} styles={styles} />
            <MapControls key={trip.id} styles={styles} />
            {/*
              Reserved for future controls / panels.
              Add new <section className={styles.section}> blocks below
              and wire them from lib/dashboard-render.ts.
            */}
          </aside>

          <button
            type="button"
            role="separator"
            aria-label="Resize information panel"
            aria-orientation="vertical"
            aria-controls="trip-sidebar trip-data-panel"
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={Math.round(sidebarMax())}
            aria-valuenow={Math.round(sidebarWidth)}
            aria-valuetext={`${Math.round(sidebarWidth)} pixels wide`}
            className={`${styles.sidebarResizeHandle} ${
              activeResize === "sidebar" ? styles.resizeHandleActive : ""
            }`}
            title="Drag to resize the left panel; use Left and Right arrow keys"
            onPointerDown={(event) => startResize("sidebar", event)}
            onPointerMove={continueResize}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onKeyDown={(event) => resizeWithKeyboard("sidebar", event)}
          />

          {/* ============= RIGHT PANEL — map + tabbed plots ============= */}
          <section
            ref={rightPanelRef}
            id="trip-data-panel"
            className={`${styles.panel} ${styles.right}`}
            style={chartHeightStyle}
          >
            <div id="trip-map-region" className={styles.mapwrap}>
              <div
                id="map"
                className={styles.mapCanvas}
                style={{ width: "100%", height: "100%", borderRadius: "18px 18px 0 0" }}
              />
              {mapReady && (
                <button
                  type="button"
                  className={`${styles.mapRotateBtn} ${
                    mapBearing !== 0 ? styles.mapRotateBtnActive : ""
                  }`}
                  onClick={toggleMapOrientation}
                  onPointerDown={(event) => event.stopPropagation()}
                  aria-pressed={mapBearing !== 0}
                  title={
                    mapBearing === 0
                      ? "Rotate map 90 degrees left"
                      : "Reset map to north up"
                  }
                >
                  <span className={styles.mapRotateIcon} aria-hidden="true">
                    {mapBearing === 0 ? "↶" : "↑"}
                  </span>
                  {mapBearing === 0 ? "Rotate 90° left" : "North up"}
                </button>
              )}
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

            <button
              type="button"
              role="separator"
              aria-label="Resize chart section"
              aria-orientation="horizontal"
              aria-controls="trip-map-region trip-chart-region"
              aria-valuemin={CHARTS_MIN}
              aria-valuemax={Math.round(chartsMax())}
              aria-valuenow={Math.round(
                chartHeight ?? chartPaneRef.current?.getBoundingClientRect().height ?? 300,
              )}
              aria-valuetext={`${Math.round(
                chartHeight ?? chartPaneRef.current?.getBoundingClientRect().height ?? 300,
              )} pixels tall`}
              className={`${styles.chartResizeHandle} ${
                activeResize === "charts" ? styles.resizeHandleActive : ""
              }`}
              title="Drag to resize the chart section; use Up and Down arrow keys"
              onPointerDown={(event) => startResize("charts", event)}
              onPointerMove={continueResize}
              onPointerUp={finishResize}
              onPointerCancel={finishResize}
              onKeyDown={(event) => resizeWithKeyboard("charts", event)}
            />

            {/* Tab strip + x-axis selector */}
            <div ref={tabsRowRef} className={styles.tabsRow}>
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
            <div id="trip-chart-region" ref={chartPaneRef} className={styles.chartPaneWrap}>
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
