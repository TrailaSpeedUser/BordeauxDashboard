/**
 * Visual helpers shared between the per-trip dashboard and the network
 * view. Kept tiny and dependency-free so it works in any context (server
 * route, client component, renderer).
 */

/**
 * Map t ∈ [0, 1] to an RGB color along a blue → green → yellow → orange →
 * red gradient. Out-of-range values clamp.
 */
export function colormapJet(t: number): string {
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

/**
 * Nearest-rank percentile. Returns NaN if no valid values.
 * `p` is in [0, 1].
 */
export function percentile(values: number[], p: number): number {
  const cleaned = values.filter((v) => !isNaN(v)).sort((a, b) => a - b);
  if (cleaned.length === 0) return NaN;
  const idx = Math.min(cleaned.length - 1, Math.max(0, Math.floor(p * (cleaned.length - 1))));
  return cleaned[idx];
}
