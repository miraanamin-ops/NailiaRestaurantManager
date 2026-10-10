// Which website a request is for, from the address it came to. Plain code with
// no imports, so every rule is unit-tested (tests/hosts.test.ts).
//
//   dinerai.co.uk / www.dinerai.co.uk  the holding site (home, privacy, terms)
//   nailiarestaurantmanager.vercel.app the old address: pages redirect to the app domain
//   anything else (app.dinerai.co.uk, previews, localhost) the app

// The app's live address (the APP_URL setting should say the same).
export const LIVE_APP_URL = "https://app.dinerai.co.uk";

export const SITE_HOSTS = ["dinerai.co.uk", "www.dinerai.co.uk"];
export const OLD_HOSTS = ["nailiarestaurantmanager.vercel.app"];

// The holding site's pages, and where they live in the app (src/app/site/...).
export const SITE_PAGES: Record<string, string> = { "/": "/site", "/privacy": "/site/privacy", "/terms": "/site/terms" };

export type HostRoute =
  | { kind: "app" }
  | { kind: "site"; rewrite: string } // show a holding-site page
  | { kind: "redirect"; to: string }; // send the visitor to the app domain

const isAsset = (path: string) => path.startsWith("/_next/") || /\.(ico|png|jpg|jpeg|svg|webp|txt|xml|webmanifest)$/.test(path);

export function hostRoute(input: { host: string | null; path: string; search: string; method: string; appUrl: string }): HostRoute {
  const host = (input.host ?? "").toLowerCase().replace(/:\d+$/, "");
  const { path, search } = input;
  if (isAsset(path)) return { kind: "app" };

  if (SITE_HOSTS.includes(host)) {
    if (SITE_PAGES[path]) return { kind: "site", rewrite: SITE_PAGES[path] };
    // Anything else typed on the main domain (e.g. a sign-up link) belongs to the app.
    return { kind: "redirect", to: `${input.appUrl}${path}${search}` };
  }

  // The old address: pages move to the app domain. API calls (the Twilio webhook, the
  // scheduler) keep working here, because a redirect would break them.
  if (OLD_HOSTS.includes(host) && !path.startsWith("/api/") && (input.method === "GET" || input.method === "HEAD")) {
    return { kind: "redirect", to: `${input.appUrl}${path}${search}` };
  }
  return { kind: "app" };
}

// Owner pages that need a login (checked in src/proxy.ts).
export function needsLogin(path: string) {
  return path === "/" || path === "/log" || path === "/settings" || /^\/(report|settings|onboarding|sales)(\/|$)/.test(path);
}
