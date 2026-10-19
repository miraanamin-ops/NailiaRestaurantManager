import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { SITE_HOSTS } from "@/lib/hosts";

// robots.txt. The public site (dinerai.co.uk) can be indexed; on the app domain
// (and previews) only the restaurant sign-up page can, never owner or customer pages.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (SITE_HOSTS.includes(host)) {
    return { rules: { userAgent: "*", allow: "/" }, sitemap: "https://dinerai.co.uk/sitemap.xml" };
  }
  const production = process.env.VERCEL_ENV === "production";
  return { rules: production ? { userAgent: "*", allow: "/start$", disallow: "/" } : { userAgent: "*", disallow: "/" } };
}
