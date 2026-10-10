import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hostRoute, LIVE_APP_URL, needsLogin } from "@/lib/hosts";

// Runs before every page. Two jobs:
// 1. Which website: dinerai.co.uk shows the holding site, the old vercel.app address
//    redirects pages to app.dinerai.co.uk, everything else is the app (lib/hosts.ts).
// 2. Owner pages need a login (Supabase magic link). This keeps the login fresh and
//    sends anyone not logged in to /login. The pages themselves then check the email
//    is allowed (lib/auth.ts). Sign-up, reward, offer and unsubscribe pages, and the
//    webhooks, don't need a login.
export async function proxy(req: NextRequest) {
  const appUrl = (process.env.APP_URL || (process.env.VERCEL_ENV === "production" ? LIVE_APP_URL : req.nextUrl.origin)).replace(/\/$/, "");
  const route = hostRoute({
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    path: req.nextUrl.pathname,
    search: req.nextUrl.search,
    method: req.method,
    appUrl,
  });
  if (route.kind === "redirect") return NextResponse.redirect(route.to, 308);
  if (route.kind === "site") return NextResponse.rewrite(new URL(route.rewrite, req.url));
  if (!needsLogin(req.nextUrl.pathname)) return NextResponse.next();

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

// Every page, but not Next.js's own files or images.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
