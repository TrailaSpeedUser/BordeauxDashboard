import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  // 303 See Other: forces the browser to switch to GET when following
  // the redirect. With the default 307 the browser would POST to /login,
  // which is a page (no POST handler) → 405.
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
