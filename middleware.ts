import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          res.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  // Touch the session so cookies refresh on each request
  await supabase.auth.getUser();

  // Gate everything except /login and the auth API behind authentication
  const url = req.nextUrl.clone();
  const isPublic =
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/api/auth/") ||
    url.pathname.startsWith("/_next/") ||
    url.pathname === "/favicon.ico";

  if (!isPublic) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      url.pathname = "/login";
      url.searchParams.set("next", req.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
