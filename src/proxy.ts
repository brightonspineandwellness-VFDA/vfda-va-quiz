import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { homeFor, isRole, isUnder, SIGNED_IN_AREAS } from "@/lib/roles";

// Runs before every page: refreshes the Supabase session cookie and keeps each
// role on its own pages. Pages check again with requireRole().
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Not configured yet: let the home page explain, but never show signed-in pages.
    const blocked = SIGNED_IN_AREAS.some((area) => isUnder(request.nextUrl.pathname, area));
    return blocked ? NextResponse.redirect(new URL("/", request.url)) : response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Must run on every request so expired sessions get refreshed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const needsSignIn = SIGNED_IN_AREAS.some((area) => isUnder(path, area));

  // Keep refreshed session cookies on redirects too.
  const redirectTo = (target: string) => {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (needsSignIn && !user) return redirectTo("/login");

  if (user && (needsSignIn || path === "/login")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const home = homeFor(isRole(profile?.role) ? profile.role : null);

    if (path === "/login" || !isUnder(path, home)) return redirectTo(home);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static files and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
