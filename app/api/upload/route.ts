import { NextResponse, type NextRequest } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseAdminClient,
} from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Columns that get their own SQL column in track_metrics.
// Everything else lands in `extra` JSONB.
const TYPED_COLUMNS = new Set([
  "ts",
  "lat",
  "lon",
  "altitude_m",
  "speed_kmh",
  "ax", "ay", "az",
  "gx", "gy", "gz",
  "acc_mag",
  "gyro_mag",
  "noise_db",
]);

type Body = {
  action: "create" | "append";
  tripId?: string | null;
  name?: string;
  notes?: string;
  metadata?: any;
  columns: string[];
  startSeq: number;
  rows: (number | null)[][];
  finalize: boolean;
};

export async function POST(req: NextRequest) {
  const supa = createSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: profile } = await supa
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  const body = (await req.json()) as Body;
  const admin = createSupabaseAdminClient();

  let tripId = body.tripId ?? null;

  // ---- create trip on first chunk ----
  if (body.action === "create") {
    if (!body.name || !body.metadata || !body.columns || !body.rows) {
      return NextResponse.json({ error: "missing create fields" }, { status: 400 });
    }
    const tsIdx = body.columns.indexOf("ts");
    const ts0 = tsIdx >= 0 ? body.rows[0]?.[tsIdx] ?? null : null;
    const session = body.metadata.session ?? null;
    const recordedOn = body.metadata.exported_at
      ? String(body.metadata.exported_at).slice(0, 10)
      : null;

    const { data: trip, error: tripErr } = await admin
      .from("trips")
      .insert({
        owner_id: user.id,
        name: body.name,
        notes: body.notes || null,
        session,
        recorded_on: recordedOn,
        ts_start_us: body.metadata.ts_start ?? ts0 ?? null,
        ts_end_us: body.metadata.ts_end ?? null,
        duration_s: body.metadata.duration_s ?? null,
        n_rows: body.metadata.rows ?? null,
        metadata: body.metadata,
      })
      .select("id")
      .single();
    if (tripErr || !trip) {
      return NextResponse.json(
        { error: tripErr?.message ?? "trip insert failed" },
        { status: 500 },
      );
    }
    tripId = trip.id;
  }

  if (!tripId) {
    return NextResponse.json({ error: "no tripId" }, { status: 400 });
  }

  // ---- insert metric rows ----
  const colIdx: Record<string, number> = {};
  body.columns.forEach((c, i) => (colIdx[c.trim()] = i));

  const records = body.rows.map((row, i) => {
    const seq = body.startSeq + i;
    const rec: any = { trip_id: tripId, seq, ts: row[colIdx["ts"]] ?? 0 };
    const extra: Record<string, number | null> = {};

    for (const col of body.columns) {
      const idx = colIdx[col];
      const v = row[idx];
      if (TYPED_COLUMNS.has(col)) {
        if (col === "ts") continue; // already set
        rec[col] = v;
      } else {
        if (col === "seq") continue; // never overwrite our seq
        extra[col] = v;
      }
    }
    rec.extra = extra;
    return rec;
  });

  // Insert in sub-chunks for safety on the DB side
  const SUB = 1000;
  for (let i = 0; i < records.length; i += SUB) {
    const slice = records.slice(i, i + SUB);
    const { error } = await admin.from("track_metrics").insert(slice);
    if (error) {
      // If the trip was just created and ingest failed, clean it up
      if (body.action === "create") {
        await admin.from("trips").delete().eq("id", tripId);
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ tripId });
}
