
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (
        cookiesToSet: {
          name: string;
          value: string;
          options?: CookieOptions;
        }[]
      ) => {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Light check only: read the session from the cookie (network only when the token
  // needs refreshing), and never wait more than 2.5 s. Pages and APIs verify the user
  // themselves, so this is just for the login/dashboard redirects.
  let user: unknown = null;
  try {
    const res = await Promise.race([
      supabase.auth.getSession(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 2500)),
    ]);
    if (res === null) return response;            // auth service slow: let the page handle it
    user = res.data.session?.user ?? null;
  } catch {
    return response;
  }

  const path = request.nextUrl.pathname;

  // The page found this login dead (account removed / token rejected): wipe the Supabase
  // cookies and show the login form, instead of bouncing back to /dashboard.
  if (path === "/login" && (request.nextUrl.searchParams.has("expired") || request.nextUrl.searchParams.has("error"))) {
    const clean = NextResponse.next({ request });
    for (const c of request.cookies.getAll()) if (c.name.startsWith("sb-")) clean.cookies.set(c.name, "", { path: "/", maxAge: 0 });
    return clean;
  }

  if (!user && path.startsWith("/dashboard")) {
    const target = request.nextUrl.clone();
    target.pathname = "/login";
    return NextResponse.redirect(target);
  }

  if (user && path === "/login") {
    const target = request.nextUrl.clone();
    target.pathname = "/dashboard";
    return NextResponse.redirect(target);
  }

  return response;
}

export const config = {
  matcher: [
    // API routes check auth themselves, so they skip middleware entirely
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
