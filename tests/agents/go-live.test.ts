// The go-live checklist and the per-restaurant switch (builder controls):
// Reputation can't be switched to live until its five profile fields are
// filled; the owner gets one short WhatsApp asking for them (at most once a day).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const READY = {
  sign_off_name: "The Ember & Spice Grill family",
  complaint_contact: "hello@ember.test",
  recovery_offers: ["A free dessert on your next visit"],
  halal_statement: "All our meat is halal.",
  allergen_statement: "Please tell our team about any allergy.",
};
let db: ReturnType<typeof memoryDb>;
const sent: string[] = [];

beforeEach(() => {
  vi.resetModules();
  sent.length = 0;
  db = memoryDb({
    restaurants: [{ id: A, name: "Ember & Spice Grill", agent_modes: {}, trust_levels: {}, owner_whatsapp: "whatsapp:+447700900111", whatsapp_from: "whatsapp:+14155238886", pilot_prompted_at: null, recovery_offers: [], profile_version: 0 }],
    audit_log: [],
    profile_versions: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.dinerai.co.uk" }));
  vi.doMock("@/lib/notify", () => ({ messageOwner: async (_c: unknown, text: string) => void sent.push(text) }));
  vi.doMock("@/lib/auth", () => ({ currentOwner: async () => ({ email: "builder@x.test", isBuilder: true, restaurantIds: [A], allowed: true }) }));
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { url });
    },
  }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/notify", "@/lib/auth", "next/navigation"]) vi.doUnmock(m);
});

async function save(mode: string) {
  const { saveBuilderControls } = await import("@/app/settings/actions");
  const form = new FormData();
  form.set("r", A);
  form.set("mode_reputation", mode);
  form.set("mode_checker", "shadow");
  try {
    await saveBuilderControls(form);
  } catch (err) {
    return decodeURIComponent((err as { url?: string }).url ?? String(err));
  }
  return "";
}

describe("switching Reputation to live", () => {
  test("missing fields: stays in shadow, the owner is asked once (and not again the same day)", async () => {
    const url = await save("live");
    expect(url).toMatch(/reputation can't go live yet: missing sign-off name, contact for complaints, recovery offers, halal statement, allergen statement/);
    expect(url).toMatch(/the owner has been sent a WhatsApp/);
    expect(db.tables.restaurants[0].agent_modes).not.toMatchObject({ reputation: "live" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/To reply to your Google reviews for you, I need your sign-off name/);
    expect(sent[0]).toContain(`https://app.dinerai.co.uk/settings?r=${A}`);
    await save("live");
    expect(sent).toHaveLength(1);
  });

  test("every field filled: it goes live", async () => {
    Object.assign(db.tables.restaurants[0], READY);
    expect(await save("live")).toMatch(/saved=builder/);
    expect(db.tables.restaurants[0].agent_modes).toMatchObject({ reputation: "live" });
    expect(sent).toEqual([]);
  });

  test("off and shadow can always be chosen", async () => {
    await save("off");
    expect(db.tables.restaurants[0].agent_modes).toMatchObject({ reputation: "off" });
    await save("shadow");
    expect(db.tables.restaurants[0].agent_modes).toMatchObject({ reputation: "shadow" });
  });

  test("only the builder can switch it", async () => {
    vi.doMock("@/lib/auth", () => ({ currentOwner: async () => ({ email: "owner@x.test", isBuilder: false, restaurantIds: [A], allowed: true }) }));
    expect(await save("live")).toMatch(/Only the builder/);
  });
});

test("the checklist names what's missing", async () => {
  const { goLiveChecklist } = await import("@/lib/agents/go-live");
  expect(goLiveChecklist({ ...db.tables.restaurants[0], ...READY, halal_statement: " " } as never, "reputation")).toMatchObject({ ready: false, missing: ["halal_statement"] });
  expect(goLiveChecklist({ ...db.tables.restaurants[0], ...READY } as never, "reputation")).toMatchObject({ ready: true });
});
