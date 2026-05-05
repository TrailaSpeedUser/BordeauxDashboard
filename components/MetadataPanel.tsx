"use client";

import type { Trip } from "@/lib/types";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; data: any }
  | { kind: "error"; message: string };

export function MetadataPanel({
  trip,
  status,
  styles,
}: {
  trip: Trip;
  status: Status;
  styles: Record<string, string>;
}) {
  const m = trip.metadata ?? {};
  const cols = m.columns ?? {};

  // Find noise band definitions in metadata
  const bandKeys = Object.keys(cols)
    .filter((k) => k.startsWith("noise_band_"))
    .sort();

  // Same color palette used in the chart — keep these in sync with
  // BAND_PALETTE in lib/dashboard-render.ts.
  const palette = ["#5a9bd5", "#c98a55", "#67ad7f", "#a48ac6", "#e0925f", "#cf6b6b"];

  const fmtDuration = (s?: number) => {
    if (!s) return "—";
    const m = Math.floor(s / 60);
    const sec = Math.round(s - m * 60);
    return `${m}m ${sec}s`;
  };

  return (
    <>
      {/* Trip header */}
      <div className={styles.section}>
        <div className={styles.tripTitle}>{trip.name}</div>
        {(trip.session ?? m.session) && (
          <div className={styles.tripSubtitle}>{trip.session ?? m.session}</div>
        )}
        <div className={styles.kv}>
          <div className={styles.card}>
            <div className={styles.k}>Recorded</div>
            <div className={styles.v}>{trip.recorded_on ?? "—"}</div>
          </div>
          <div className={styles.card}>
            <div className={styles.k}>Duration</div>
            <div className={styles.v}>{fmtDuration(trip.duration_s ?? m.duration_s)}</div>
          </div>
          <div className={styles.card}>
            <div className={styles.k}>Samples</div>
            <div className={styles.v}>
              {(trip.n_rows ?? m.rows ?? 0).toLocaleString("en-US")}
            </div>
          </div>
          <div className={styles.card}>
            <div className={styles.k}>Sampling</div>
            <div className={styles.v}>
              {m.median_sampling_hz
                ? `${Number(m.median_sampling_hz).toFixed(2)} Hz`
                : "—"}
            </div>
          </div>
        </div>
        {trip.notes && (
          <div className={styles.card} style={{ marginTop: 10 }}>
            <div className={styles.k}>Notes</div>
            <div className={styles.v} style={{ fontWeight: 400 }}>
              {trip.notes}
            </div>
          </div>
        )}
      </div>

      {/* Noise band definitions from metadata */}
      {bandKeys.length > 0 && (
        <div className={styles.section}>
          <h2>Noise bands</h2>
          <div className={styles.bandList}>
            {bandKeys.map((k, i) => {
              const def = cols[k] ?? {};
              const name = def.name ?? k;
              return (
                <div key={k} className={styles.bandRow}>
                  <span>
                    <span
                      className="swatch"
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        marginRight: 8,
                        verticalAlign: "middle",
                        background: palette[i % palette.length],
                      }}
                    />
                    <span className={styles.bandName}>
                      {String(name).charAt(0).toUpperCase() + String(name).slice(1)}
                    </span>
                  </span>
                  <span>
                    {def.f_low_hz}–{def.f_high_hz} Hz
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Audio processing details */}
      {m.audio_processing && (
        <div className={styles.section}>
          <h2>Audio processing</h2>
          <div className={styles.kv}>
            <div className={styles.card}>
              <div className={styles.k}>n_fft</div>
              <div className={styles.v}>{m.audio_processing.n_fft}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.k}>Window</div>
              <div className={styles.v}>{m.audio_processing.window}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.k}>Overlap</div>
              <div className={styles.v}>
                {m.audio_processing.noverlap_frac
                  ? `${(m.audio_processing.noverlap_frac * 100).toFixed(0)} %`
                  : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status */}
      {status.kind === "loading" && (
        <div className={styles.section}>
          <div className={styles.small}>Loading metrics…</div>
        </div>
      )}
    </>
  );
}
