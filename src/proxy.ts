import { NextResponse, type NextRequest } from "next/server";

// The test-data dashboard (/) shows every customer, message and draft, so it
// needs a password: the DASHBOARD_PASSWORD environment variable. The browser
// asks for a username and password; any username works. With no password set,
// the page stays locked. (Customer pages, report links and the webhooks are not affected.)
export function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return new NextResponse("The dashboard is locked: set DASHBOARD_PASSWORD in Vercel to open it.", { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const given = decoded.slice(decoded.indexOf(":") + 1);
      if (given.length === password.length && safeEqual(given, password)) return NextResponse.next();
    } catch {
      // Malformed header: ask again.
    }
  }
  return new NextResponse("Password required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Naila dashboard", charset="UTF-8"' },
  });
}

// Compares every character, so the time taken doesn't hint at how much was right.
function safeEqual(a: string, b: string) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = { matcher: "/" };
