import { NextResponse, type NextRequest } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseAdminClient,
} from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk delete one or more trips.
 *
 * Body: { ids: string[] }
 *
 * RLS would block non-admins anyway, but we double-check the role here
 * to return a clean 403 with a useful error message.
 *
 * track_metrics rows are removed automatically via the FK ON DELETE
 * CASCADE on track_metrics.trip_id.
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
  const { error } = await admin.from("trips").delete().in("id", ids);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: ids.length });
}
