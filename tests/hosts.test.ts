// Which website a request is for: the holding site, a redirect from the old
// address, or the app. And which pages need a login.
import { describe, expect, test } from "vitest";
import { hostRoute, needsLogin } from "@/lib/hosts";

const APP = "https://app.dinerai.co.uk";
const route = (host: string, path: string, method = "GET", search = "") => hostRoute({ host, path, search, method, appUrl: APP });

describe("dinerai.co.uk: the holding site", () => {
  test("home, privacy and terms", () => {
    expect(route("dinerai.co.uk", "/")).toEqual({ kind: "site", rewrite: "/site" });
    expect(route("www.dinerai.co.uk", "/privacy")).toEqual({ kind: "site", rewrite: "/site/privacy" });
    expect(route("DinerAI.co.uk:443", "/terms")).toEqual({ kind: "site", rewrite: "/site/terms" });
  });
  test("anything else goes to the app, keeping the path", () => {
    expect(route("dinerai.co.uk", "/r/ember-spice", "GET", "?x=1")).toEqual({ kind: "redirect", to: `${APP}/r/ember-spice?x=1` });
    expect(route("www.dinerai.co.uk", "/login")).toEqual({ kind: "redirect", to: `${APP}/login` });
  });
  test("the site's own files load", () => {
    expect(route("dinerai.co.uk", "/_next/static/chunks/a.js")).toEqual({ kind: "app" });
    expect(route("dinerai.co.uk", "/favicon.ico")).toEqual({ kind: "app" });
  });
});

describe("the old vercel.app address", () => {
  test("pages redirect to the same page on the app domain", () => {
    expect(route("nailiarestaurantmanager.vercel.app", "/reward/abc")).toEqual({ kind: "redirect", to: `${APP}/reward/abc` });
    expect(route("nailiarestaurantmanager.vercel.app", "/report/t", "HEAD")).toEqual({ kind: "redirect", to: `${APP}/report/t` });
  });
  test("webhooks, the scheduler and form posts keep working there (a redirect would break them)", () => {
    expect(route("nailiarestaurantmanager.vercel.app", "/api/whatsapp", "POST")).toEqual({ kind: "app" });
    expect(route("nailiarestaurantmanager.vercel.app", "/api/cron", "GET")).toEqual({ kind: "app" });
    expect(route("nailiarestaurantmanager.vercel.app", "/r/ember-spice", "POST")).toEqual({ kind: "app" });
  });
});

describe("the app", () => {
  test("app domain, previews and localhost are the app", () => {
    expect(route("app.dinerai.co.uk", "/")).toEqual({ kind: "app" });
    expect(route("nailiarestaurantmanager-git-domains-x.vercel.app", "/r/ember-spice")).toEqual({ kind: "app" });
    expect(route("localhost:3000", "/")).toEqual({ kind: "app" });
  });
  test("owner pages need a login; customer pages don't", () => {
    for (const p of ["/", "/log", "/settings", "/settings/email-preview", "/report/abc", "/onboarding", "/onboarding/setup"]) expect(needsLogin(p)).toBe(true);
    for (const p of ["/r/ember-spice", "/reward/x", "/start", "/login", "/export/download", "/api/whatsapp", "/site", "/reports"]) expect(needsLogin(p)).toBe(false);
  });
});
