import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns all track_metrics rows for a trip, ordered by sequence.
 *
 * Response shape:
 *  {
 *    columns: string[],          // typed columns + extra keys, in order
 *    rows: number[][]            // values aligned with `columns`, nulls as null
 *  }
 *
 * Returning a column-oriented array is ~6x smaller than an array of objects
 * for this workload (3.5k rows × 18 cols), which matters for cold loads.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createSupabaseServerClient();

  // Verify the user has access (RLS would also block, but we want clear errors)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Page through results — Supabase caps at 1000 rows per request
  const PAGE = 1000;
  let from = 0;
  let allRows: any[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("track_metrics")
      .select(
        "seq, ts, datetime, distance_m, lat, lon, altitude_m, speed_kmh, ax, ay, az, gx, gy, gz, acc_mag, gyro_mag, noise_db, extra",
      )
      .eq("trip_id", params.id)
      .order("seq", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  if (allRows.length === 0) {
    return NextResponse.json({ columns: [], rows: [] });
  }

  // Discover all extra keys present anywhere in the dataset
  const extraKeys = new Set<string>();
  for (const r of allRows) {
    if (r.extra && typeof r.extra === "object") {
      for (const k of Object.keys(r.extra)) extraKeys.add(k);
    }
  }
  const extraList = Array.from(extraKeys).sort();

  const typedColumns = [
    "seq",
    "ts",
    "datetime",        // epoch ms (converted below)
    "distance_m",
    "lat",
    "lon",
    "altitude_m",
    "speed_kmh",
    "ax",
    "ay",
    "az",
    "gx",
    "gy",
    "gz",
    "acc_mag",
    "gyro_mag",
    "noise_db",
  ];
  const columns = [...typedColumns, ...extraList];

  const rows = allRows.map((r) => {
    const out: (number | null)[] = typedColumns.map((c) => {
      const v = r[c];
      if (v === undefined || v === null) return null;
      if (c === "datetime") {
        // Postgres timestamptz comes back as ISO string. Convert to epoch
        // ms so the client-side response shape stays uniformly numeric
        // (Chart.js consumes epoch ms natively for linear time axes).
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : null;
      }
      return Number(v);
    });
    for (const k of extraList) {
      const v = r.extra?.[k];
      out.push(v === undefined || v === null ? null : Number(v));
    }
    return out;
  });

  return NextResponse.json({ columns, rows });
}
