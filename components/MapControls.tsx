"use client";

import { useEffect, useState } from "react";

type Band = { column: string; name: string; range: string };

/**
 * Map overlay controls — band selector + percentile threshold slider.
 *
 * Reads the available bands from a global the renderer publishes, and
 * calls a global update function when the user changes either control.
 * The renderer keeps the map alive across changes; we just recolor.
 */
export function MapControls({ styles }: { styles: Record<string, string> }) {
  const [bands, setBands] = useState<Band[] | null>(null);
  const [activeColumn, setActiveColumn] = useState<string>("");
  const [percentile, setPercentile] = useState<number>(0); // 0..1

  // Pick up the bands published by the renderer once it's run.
  // We poll briefly because the renderer runs after Leaflet/Chart.js
  // load, which is asynchronous and not React-state-driven.
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      const w = window as any;
      if (w.__trailaBands && w.__trailaBands.length) {
        setBands(w.__trailaBands as Band[]);
        setActiveColumn(w.__trailaInitialBand ?? w.__trailaBands[0].column);
        clearInterval(id);
      } else if (++tries > 60) {
        // ~6s — give up; renderer probably failed
        clearInterval(id);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  // Push changes to the renderer
  useEffect(() => {
    if (!activeColumn) return;
    const update = (window as any).__trailaUpdateOverlay as
      | ((b: string, p: number) => void)
      | undefined;
    update?.(activeColumn, percentile);
  }, [activeColumn, percentile]);

  if (!bands) {
    return (
      <div className={styles.section}>
        <h2>Map overlay</h2>
        <div className={styles.small}>Loading…</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h2>Map overlay</h2>

      {/* Band selector — small button strip */}
      <div className={styles.bandStrip}>
        {bands.map((b) => (
          <button
            key={b.column}
            type="button"
            className={`${styles.bandBtn} ${
              activeColumn === b.column ? styles.bandBtnActive : ""
            }`}
            onClick={() => setActiveColumn(b.column)}
            title={b.range ? `${b.name} (${b.range})` : b.name}
          >
            {b.name}
          </button>
        ))}
      </div>

      {/* Percentile threshold */}
      <div className={styles.thresholdRow}>
        <div className={styles.thresholdLabel}>
          <span>Highlight loudest</span>
          <strong>
            {percentile === 0
              ? "all"
              : `top ${((1 - percentile) * 100).toFixed(0)}%`}
          </strong>
        </div>
        <input
          type="range"
          min={0}
          max={0.95}
          step={0.05}
          value={percentile}
          onChange={(e) => setPercentile(parseFloat(e.target.value))}
          className={styles.thresholdSlider}
        />
        <div className={styles.thresholdHelper}>
          Below-threshold segments are faded, not hidden — geographic context stays.
        </div>
      </div>
    </div>
  );
}
