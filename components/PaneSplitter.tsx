"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Drag handle that sets the height of the chart pane below the map.
 *
 * The right-hand column is a flex column: the map is elastic and the
 * chart pane is fixed-height, so resizing the chart is what moves the
 * boundary — the map just absorbs the difference. The height is written
 * as a `--chart-h` custom property on the panel element rather than as
 * React state, so a drag never re-renders the dashboard (a re-render
 * would tear down and rebuild the Leaflet map).
 *
 * Both sides already handle being resized: Leaflet via the
 * ResizeObserver in dashboard-render.ts, Chart.js via `responsive`.
 */

const STORAGE_KEY = "traila-chart-height";
/** Keep the plot usable. */
const MIN_CHART = 160;
/** Matches .mapwrap's min-height so the CSS floor and the drag clamp agree. */
const MIN_MAP = 280;
/** Arrow-key step, in px. */
const KEY_STEP = 24;

export function PaneSplitter({
  panelRef,
  styles,
}: {
  panelRef: React.RefObject<HTMLElement | null>;
  styles: Record<string, string>;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  /** Current chart height in px, falling back to the rendered height. */
  const currentHeight = useCallback(() => {
    const panel = panelRef.current;
    const pane = panel?.querySelector<HTMLElement>(`.${styles.chartPaneWrap}`);
    return pane?.getBoundingClientRect().height ?? MIN_CHART;
  }, [panelRef, styles.chartPaneWrap]);

  /** Clamp so neither pane can be squeezed out of existence. */
  const apply = useCallback(
    (px: number) => {
      const panel = panelRef.current;
      const handle = handleRef.current;
      if (!panel || !handle) return 0;

      // The tab strip sits between the handle and the pane and keeps its
      // natural height, so it comes off the budget.
      const tabsH =
        handle.nextElementSibling?.getBoundingClientRect().height ?? 0;
      const maxChart =
        panel.getBoundingClientRect().height -
        MIN_MAP -
        tabsH -
        handle.getBoundingClientRect().height;

      const next = Math.round(
        Math.max(MIN_CHART, Math.min(px, Math.max(MIN_CHART, maxChart))),
      );
      panel.style.setProperty("--chart-h", `${next}px`);
      handle.setAttribute("aria-valuenow", String(next));
      return next;
    },
    [panelRef],
  );

  // Restore the last size. Runs once the panel is mounted so the clamp
  // has a real height to measure against.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) apply(Number(saved));
    } catch {
      // Private mode / blocked storage: fall back to the CSS default.
    }
  }, [apply]);

  const persist = (px: number) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(px));
    } catch {
      // Not worth surfacing — the size still applies for this session.
    }
  };

  const fromPointer = (clientY: number) => {
    const panel = panelRef.current;
    const handle = handleRef.current;
    if (!panel || !handle) return MIN_CHART;
    const tabsH =
      handle.nextElementSibling?.getBoundingClientRect().height ?? 0;
    // Distance from the pointer to the bottom of the panel, less the tab
    // strip, is what the chart pane should occupy.
    return panel.getBoundingClientRect().bottom - clientY - tabsH;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Stop the pointer from selecting text or turning into an I-beam
    // while the drag is in flight.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    apply(fromPointer(e.clientY));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    persist(apply(fromPointer(e.clientY)));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Up grows the map and shrinks the plot, matching the drag direction.
    const delta =
      e.key === "ArrowUp" ? -KEY_STEP : e.key === "ArrowDown" ? KEY_STEP : 0;
    if (!delta) return;
    e.preventDefault();
    persist(apply(currentHeight() + delta));
  };

  return (
    <div
      ref={handleRef}
      className={styles.splitter}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      // A separator is the ARIA role for a draggable pane divider; it is
      // focusable so the size is reachable without a pointer.
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the plot area"
      aria-valuemin={MIN_CHART}
      tabIndex={0}
    />
  );
}
