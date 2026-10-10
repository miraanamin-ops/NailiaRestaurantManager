import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Owner pages need a login (Supabase magic link). This keeps the login fresh
// and sends anyone not logged in to /login. The pages themselves then check the
// email is allowed (lib/auth.ts). Sign-up, reward, offer and unsubscribe pages,
// and the webhooks, aren't covered by this at all.
export async function proxy(req: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return new NextResponse("Owner pages are locked: set SUPABASE_PUBLISHABLE_KEY to turn on login.", { status: 503 });
  }

  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        response = NextResponse.next({ request: req });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = { matcher: ["/", "/log", "/report/:path*", "/settings", "/onboarding/:path*"] };
