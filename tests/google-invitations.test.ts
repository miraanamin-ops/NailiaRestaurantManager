// Owners' invitations to our manager account (lib/google/invitations.ts): accepted
// and linked with nobody in the mailbox, but only when exactly one restaurant
// that's waiting for Google matches; anything else is left for the builder.
// Against a mocked Google API (as tests/google-live.test.ts).
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { matchInvitation, nameKey, postcodeOf } from "@/lib/google/invitations-rules";
import { googleWriteRefused } from "@/lib/gate-rules";
import { memoryDb } from "./support/memory-db";

describe("matching an invitation to a restaurant", () => {
  const waiting = [
    { id: "mn", name: "Maison Noor", address: "12 Ilford Lane, Ilford IG1 2AB" },
    { id: "eg", name: "Ember & Spice Grill", address: "1 High St, London E1 6AN" },
  ];
  test("the same name; or a close name with the same postcode; never a guess", () => {
    expect(nameKey("Maison  Noor!")).toBe("maison noor");
    expect(postcodeOf("12 Ilford Lane, Ilford ig1 2ab")).toBe("IG12AB");
    expect(matchInvitation({ locationName: "Maison Noor", address: "somewhere else" }, waiting)).toEqual({ restaurantId: "mn" });
    expect(matchInvitation({ locationName: "Ember and Spice Grill", address: "" }, waiting)).toEqual({ restaurantId: "eg" });
    expect(matchInvitation({ locationName: "Maison Noor Food Hall", address: "12 Ilford Lane, IG1 2AB" }, waiting)).toEqual({ restaurantId: "mn" });
    expect(matchInvitation({ locationName: "Maison Noor Food Hall", address: "Leeds LS1 4AP" }, waiting)).toMatchObject({ restaurantId: null });
    expect(matchInvitation({ locationName: "Tayyabs", address: "E1 1JU" }, waiting)).toEqual({ restaurantId: null, reason: "no restaurant waiting for Google matches it" });
    expect(matchInvitation({ locationName: "Maison Noor" }, [...waiting, { id: "mn2", name: "Maison Noor", address: null }])).toMatchObject({ restaurantId: null, reason: expect.stringMatching(/2 waiting restaurants match/) });
  });

  test("accepting an invitation passes the Google wall (it changes no listing); other writes still need a restaurant", () => {
    const ctx = { production: true };
    expect(googleWriteRefused("POST", null, "https://mybusinessaccountmanagement.googleapis.com/v1/accounts/123/invitations/abc:accept", ctx)).toBeNull();
    expect(googleWriteRefused("POST", null, "https://mybusinessaccountmanagement.googleapis.com/v1/accounts/123/invitations", ctx)).toMatch(/must say which restaurant/);
    expect(googleWriteRefused("POST", null, "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts", ctx)).toMatch(/must say which restaurant/);
  });
});

// ---------- Against the mocked Google API ----------

const MN = "aaaaaaaa-0000-0000-0000-0000000000a1"; // waiting for Google
const OTHER = "aaaaaaaa-0000-0000-0000-0000000000a2"; // not waiting
const CONN = "cccccccc-0000-0000-0000-0000000000a1";
let db: ReturnType<typeof memoryDb>;
let calls: { method: string; path: string }[];
let accepted: boolean;
let invitations: { name: string; targetLocation?: { locationName: string; address: string } }[];
const alerts: string[] = [];

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("GOOGLE_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("GOOGLE_MODE", "live");
  vi.stubEnv("VERCEL_ENV", "production");
  alerts.length = 0;
  calls = [];
  accepted = false;
  invitations = [{ name: "accounts/111/invitations/inv1", targetLocation: { locationName: "Maison Noor", address: "12 Ilford Lane, Ilford IG1 2AB" } }];
  const { encryptToken } = await import("@/lib/google/crypto");
  db = memoryDb({
    restaurants: [
      { id: MN, name: "Maison Noor", address: "12 Ilford Lane, Ilford IG1 2AB", is_test: false, pilot_zero: true, google_location_id: null, owner_whatsapp: "whatsapp:+447463775130" },
      { id: OTHER, name: "A Real Grill", address: "E1 6AN", is_test: false, pilot_zero: false, google_location_id: null },
    ],
    onboarding_steps: [
      { restaurant_id: MN, step_key: "google", status: "in_progress", waiting_on: "google", data: { invited_at: "2026-11-02T18:39:41Z" } },
      { restaurant_id: OTHER, step_key: "google", status: "in_progress", waiting_on: null, data: {} },
    ],
    google_connections: [{ id: CONN, restaurant_id: null, kind: "manager", google_email: "dina@dinerai.co.uk", status: "ok", refresh_token_enc: encryptToken("r"), access_token_enc: encryptToken("a"), access_expires_at: "2030-01-01T00:00:00Z" }],
    audit_log: [],
  });
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/v1/accounts") return json({ accounts: [{ name: "accounts/111", type: "PERSONAL" }, ...(accepted ? [{ name: "accounts/222", type: "LOCATION_GROUP" }] : [])] });
    if (url.pathname.endsWith("/invitations")) return json({ invitations: accepted ? invitations.slice(1) : invitations });
    if (url.pathname.endsWith(":accept")) return (accepted = true), json({});
    if (url.pathname === "/v1/accounts/222/locations") return json({ locations: [{ name: "locations/9", title: "Maison Noor", storefrontAddress: { addressLines: ["12 Ilford Lane"], locality: "Ilford", postalCode: "IG1 2AB" } }] });
    if (url.pathname.endsWith("/locations")) return json({ locations: [] });
    return json({});
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "sent") }));
  vi.doMock("@/lib/google/import", () => ({ importFromGoogle: async () => ({}) }));
  vi.doMock("@/lib/onboarding/engine", () => ({ confirmFromGoogleImport: async () => {} }));
  vi.doMock("@/lib/onboarding/dina/google-step", () => ({
    markGoogleAccepted: async (rid: string) => {
      Object.assign(db.tables.onboarding_steps.find((s) => s.restaurant_id === rid && s.step_key === "google")!, { status: "done" });
      return "I'm in! Your profile has no reviews yet.";
    },
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/google/import", "@/lib/onboarding/engine", "@/lib/onboarding/dina/google-step"]) vi.doUnmock(m);
});

const row = (id: string) => db.tables.restaurants.find((r) => r.id === id)!;

describe("accepting and linking", () => {
  test("a matching invitation: accepted, the profile linked, Dina's step done, nobody touched the mailbox", async () => {
    const { acceptManagerInvitations } = await import("@/lib/google/invitations");
    const run = await acceptManagerInvitations({ quiet: true });
    expect(run).toMatchObject({ accepted: [MN], linked: [MN], left: [], said: { [MN]: "I'm in! Your profile has no reviews yet." } });
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/v1/accounts/111/invitations/inv1:accept"]);
    expect(row(MN)).toMatchObject({ google_connection_id: CONN, google_account_id: "accounts/222", google_location_id: "locations/9", google_location_title: "Maison Noor" });
    expect(db.tables.onboarding_steps.find((s) => s.restaurant_id === MN)?.status).toBe("done");
    expect(row(OTHER).google_location_id).toBeNull();
    expect(alerts).toEqual([]);
    expect(db.tables.audit_log[0]).toMatchObject({ restaurant_id: MN, action: "google", detail: expect.stringMatching(/accepted automatically/) });
  });

  test("an invitation that matches nobody waiting: not accepted, the builder alerted", async () => {
    invitations = [{ name: "accounts/111/invitations/inv9", targetLocation: { locationName: "Tayyabs", address: "83 Fieldgate St, London E1 1JU" } }];
    const { acceptManagerInvitations } = await import("@/lib/google/invitations");
    const run = await acceptManagerInvitations();
    expect(run).toMatchObject({ accepted: [], linked: [], left: ["accounts/111/invitations/inv9"] });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(alerts).toEqual([expect.stringMatching(/"Tayyabs" .* wasn't accepted: no restaurant waiting for Google matches it/)]);
  });

  test("accepted by hand earlier: the visible profile is linked anyway; a restaurant that already has one is left alone", async () => {
    invitations = [];
    accepted = true; // the location group is already visible
    const { acceptManagerInvitations } = await import("@/lib/google/invitations");
    expect(await acceptManagerInvitations()).toMatchObject({ accepted: [], linked: [MN] });
    expect(row(MN).google_location_id).toBe("locations/9");
    expect(await acceptManagerInvitations()).toMatchObject({ linked: [] });
  });

  test("no manager account connected: nothing happens", async () => {
    db.tables.google_connections[0].status = "needs_reconnect";
    const { acceptManagerInvitations } = await import("@/lib/google/invitations");
    expect(await acceptManagerInvitations()).toMatchObject({ skipped: "no manager account connected" });
    expect(calls).toEqual([]);
  });
});
