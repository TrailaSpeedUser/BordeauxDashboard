import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT_COLUMNS =
  "seq, ts, datetime, distance_m, lat, lon, altitude_m, speed_kmh, ax, ay, az, gx, gy, gz, acc_mag, gyro_mag, noise_db, extra";

function uniformOffsets(total: number, maxRows: number): Set<number> | null {
  if (total <= maxRows) return null;
  const offsets = new Set<number>();
  const scale = (total - 1) / (maxRows - 1);
  for (let i = 0; i < maxRows; i++) {
    offsets.add(Math.round(i * scale));
  }
  return offsets;
}

/**
 * Returns track_metrics rows for a trip, ordered by sequence. Callers can
 * request a uniformly sampled visualization payload with `?maxRows=N`;
 * omitting it preserves the full-resolution API behavior.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const requestedMaxRows = Number(req.nextUrl.searchParams.get("maxRows"));
  const maxRows = Number.isFinite(requestedMaxRows) && requestedMaxRows > 1
    ? Math.min(50_000, Math.max(1_000, Math.floor(requestedMaxRows)))
    : null;

  // Supabase caps a response at 1000 rows. For the sampled dashboard request,
  // fetch independent pages concurrently and retain only display-resolution
  // rows. The full data remains in track_metrics and is still available when
  // the endpoint is called without maxRows.
  const PAGE = 1000;
  const PAGE_CONCURRENCY = 6;
  const allRows: any[] = [];
  const extraKeys = new Set<string>();
  let scannedRows = 0;

  const fetchPage = (from: number, includeCount = false) =>
    supabase
      .from("track_metrics")
      .select(SELECT_COLUMNS, includeCount ? { count: "exact" } : undefined)
      .eq("trip_id", params.id)
      .order("seq", { ascending: true })
      .range(from, from + PAGE - 1);

  const firstPage = await fetchPage(0, maxRows !== null);
  if (firstPage.error) {
    return NextResponse.json({ error: firstPage.error.message }, { status: 500 });
  }

  const totalRows = firstPage.count ?? null;
  const selectedOffsets =
    maxRows !== null && totalRows !== null
      ? uniformOffsets(totalRows, maxRows)
      : null;

  const collectPage = (data: any[], from: number) => {
    scannedRows += data.length;
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row.extra && typeof row.extra === "object") {
        for (const key of Object.keys(row.extra)) extraKeys.add(key);
      }
      if (!selectedOffsets || selectedOffsets.has(from + i)) {
        allRows.push(row);
      }
    }
  };

  collectPage(firstPage.data ?? [], 0);

  if (totalRows !== null) {
    const starts: number[] = [];
    for (let from = PAGE; from < totalRows; from += PAGE) starts.push(from);

    for (let i = 0; i < starts.length; i += PAGE_CONCURRENCY) {
      const batchStarts = starts.slice(i, i + PAGE_CONCURRENCY);
      const results = await Promise.all(batchStarts.map((from) => fetchPage(from)));
      const failed = results.find((result) => result.error);
      if (failed?.error) {
        return NextResponse.json({ error: failed.error.message }, { status: 500 });
      }
      // Promise.all preserves input order, so rows stay sequence-ordered.
      for (let j = 0; j < results.length; j++) {
        collectPage(results[j].data ?? [], batchStarts[j]);
      }
    }
  } else {
    // Exact counts can be disabled by backend configuration. Preserve the
    // full-resolution sequential behavior in that uncommon fallback.
    let from = PAGE;
    let previousLength = firstPage.data?.length ?? 0;
    while (previousLength === PAGE) {
      const page = await fetchPage(from);
      if (page.error) {
        return NextResponse.json({ error: page.error.message }, { status: 500 });
      }
      const rows = page.data ?? [];
      collectPage(rows, from);
      previousLength = rows.length;
      from += PAGE;
    }
  }

  if (allRows.length === 0) {
    return NextResponse.json({
      columns: [],
      rows: [],
      totalRows: totalRows ?? scannedRows,
      sampled: false,
    });
  }

  const extraList = Array.from(extraKeys).sort();
  const typedColumns = [
    "seq",
    "ts",
    "datetime",
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

  const rows = allRows.map((row) => {
    const out: (number | null)[] = typedColumns.map((column) => {
      const value = row[column];
      if (value === undefined || value === null) return null;
      if (column === "datetime") {
        const time = Date.parse(value);
        return Number.isFinite(time) ? time : null;
      }
      return Number(value);
    });
    for (const key of extraList) {
      const value = row.extra?.[key];
      out.push(value === undefined || value === null ? null : Number(value));
    }
    return out;
  });

  return NextResponse.json({
    columns,
    rows,
    totalRows: totalRows ?? scannedRows,
    sampled: selectedOffsets !== null,
  });
}
