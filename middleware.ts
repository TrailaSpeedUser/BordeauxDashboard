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

  // Single getUser() call serves two purposes: (1) refresh the session
  // cookie if needed, (2) tell us whether the request is authenticated.
  // Wrap in try/catch because getUser() throws an AuthApiError when no
  // refresh token exists (first navigation, expired session, signed-out
  // requests). That's expected, not a bug — just treat it as "no user".
  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  // Gate everything except /login and the auth API behind authentication
  const url = req.nextUrl.clone();
  const isPublic =
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/api/auth/") ||
    url.pathname.startsWith("/_next/") ||
    url.pathname === "/favicon.ico";

  if (!isPublic && !user) {
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
