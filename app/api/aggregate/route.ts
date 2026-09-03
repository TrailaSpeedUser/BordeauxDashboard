import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Network-wide spatial aggregation across all trips.
 *
 * GET /api/aggregate?band=noise_band_4
 *
 * Bins lat/lon to ~11m cells, computes P95 of the chosen band column
 * per cell. The actual aggregation happens in a Postgres function
 * (traila_aggregate_cells, see migration 0003) so it runs in-database
 * with no row-streaming overhead.
 *
 * Future-proofing — when filters land (date range, bbox, speed, etc.)
 * they get added as parameters to the SQL function and forwarded from
 * here. The response shape stays the same, so the frontend evolves
 * independently.
 */

const ALLOWED_BANDS = new Set([
  "noise_db",
  "noise_band_1",
  "noise_band_2",
  "noise_band_3",
  "noise_band_4",
]);

export async function GET(req: NextRequest) {
  const supa = createSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const band = url.searchParams.get("band") ?? "noise_band_4";
  if (!ALLOWED_BANDS.has(band)) {
    return NextResponse.json(
      { error: `band must be one of ${Array.from(ALLOWED_BANDS).join(", ")}` },
      { status: 400 },
    );
  }

  const { data, error } = await supa.rpc("traila_aggregate_cells", {
    band_column: band,
  });
  if (error) {
    return NextResponse.json(
      { error: error.message, hint: "Did migration 0003 run? Check Supabase SQL editor." },
      { status: 500 },
    );
  }

  const cells = (data as any[]) ?? [];
  const totalSamples = cells.reduce((s, c) => s + Number(c.n_samples ?? 0), 0);

  // Trip count for the summary line — small extra query, not on hot path
  const { count: tripCount } = await supa
    .from("trips")
    .select("id", { count: "exact", head: true });

  return NextResponse.json({
    band,
    cells,
    summary: {
      n_trips: tripCount ?? null,
      n_samples_in_cells: totalSamples,
      n_cells: cells.length,
    },
  });
}
