import { NextResponse, type NextRequest } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseAdminClient,
} from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Large cascades take tens of seconds; the platform default would cut the
// request off well before the RPC's own 120s statement_timeout.
export const maxDuration = 60;

/**
 * Bulk delete one or more trips.
 *
 * Body: { ids: string[] }
 *
 * RLS would block non-admins anyway, but we double-check the role here
 * to return a clean 403 with a useful error message.
 *
 * Deletion goes through the delete_trips() RPC (migration 0003) rather
 * than a plain .delete(). The FK ON DELETE CASCADE fires as a per-row
 * trigger and blows past Supabase's per-role statement timeout on large
 * sessions; the RPC deletes track_metrics set-based under its own
 * raised timeout. See supabase/migrations/0003_delete_trips_rpc.sql.
 */
export async function POST(req: NextRequest) {
  const supa = createSupabaseServerClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: profile } = await supa
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  const body = (await req.json()) as { ids?: string[] };
  const ids = (body.ids ?? []).filter(
    (s) => typeof s === "string" && s.length > 0,
  );
  if (ids.length === 0) {
    return NextResponse.json({ error: "no ids provided" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("delete_trips", { p_ids: ids });
  if (error) {
    // 57014 is Postgres' statement_timeout. Surface something the user
    // can act on instead of the raw driver message.
    const timedOut =
      error.code === "57014" || /statement timeout/i.test(error.message);
    return NextResponse.json(
      {
        error: timedOut
          ? "Delete timed out — the trip has too many samples to remove in one pass. Retry, or delete it from the Supabase SQL editor."
          : error.message,
      },
      { status: timedOut ? 504 : 500 },
    );
  }

  return NextResponse.json({ deleted: typeof data === "number" ? data : ids.length });
}
