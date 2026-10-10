// Three real onboardings (see vitest.e2e.config.mts): fully on the web, fully on
// WhatsApp, and switching halfway. The web run calls the engine exactly as the
// wizard's buttons do; the WhatsApp runs go through the real conversation code.
// WhatsApp messages are captured instead of sent (the test numbers are fake).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test, vi } from "vitest";

const SANDBOX = "whatsapp:+14155238886";
const MENU_DIR = process.env.E2E_MENU_DIR ?? "";
const sent: { to: string; text: string }[] = [];

vi.mock("@/lib/notify", () => ({
  messageOwner: async (channel: { to: string }, text: string) => {
    sent.push({ to: channel.to, text });
  },
}));
vi.mock("@/lib/photos", async (orig) => ({
  ...(await orig<object>()),
  downloadTwilioMedia: async (url: string) => readFileSync(join(MENU_DIR, url.split("/").pop()!)),
}));

type Engine = typeof import("@/lib/onboarding/engine");
type Flow = typeof import("@/lib/onboarding/whatsapp-flow");
type Store = typeof import("@/lib/onboarding/store");
let engine: Engine, flow: Flow, store: Store;
let cleanMenu: typeof import("@/lib/onboarding/menu-input").cleanMenu;
let customerSafeMenu: typeof import("@/lib/onboarding/profile-data").customerSafeMenu;
let handleMessage: typeof import("@/lib/bot").handleMessage;
const made: string[] = [];
const timings: Record<string, number> = {};

beforeAll(async () => {
  expect(process.env.TEST_MODE).toBe("true");
  engine = await import("@/lib/onboarding/engine");
  flow = await import("@/lib/onboarding/whatsapp-flow");
  store = await import("@/lib/onboarding/store");
  ({ cleanMenu } = await import("@/lib/onboarding/menu-input"));
  ({ customerSafeMenu } = await import("@/lib/onboarding/profile-data"));
  ({ handleMessage } = await import("@/lib/bot"));
});

const photos = () => ["page1.jpg", "page2.jpg"].map((f) => ({ bytes: readFileSync(join(MENU_DIR, f)), contentType: "image/jpeg" as const }));

async function signUp(name: string, number: string) {
  const r = await store.createRestaurantFromSignup({ ownerName: "Test Owner", email: process.env.BUILDER_EMAIL ?? "test@example.com", restaurantName: name, whatsapp: number });
  made.push(r.id);
  return r;
}

// One WhatsApp message from the owner; returns what Naila replied.
async function say(restaurantId: string, owner: string, body: string, media: { url: string; contentType: string }[] = []) {
  const from = sent.length;
  await flow.handleOnboardingMessage({ restaurantId, owner, sandbox: SANDBOX, body, media });
  const replies = sent.slice(from).map((m) => m.text).join("\n---\n");
  expect(replies).not.toMatch(/something went wrong/i);
  return replies;
}
async function link(restaurantId: string, owner: string) {
  const o = (await store.getOnboarding(restaurantId))!;
  const from = sent.length;
  await flow.linkFromWhatsApp(o.link_code!, owner, SANDBOX);
  return sent.slice(from).map((m) => m.text).join("\n---\n");
}

describe("onboarding, for real", () => {
  test("A: fully on the web", async () => {
    const t0 = Date.now();
    const r = await signUp("Tayyabs", "whatsapp:+447700900991");
    const { candidates } = await engine.findOnGoogle(r.id, "Whitechapel");
    console.log("A Google:", candidates.map((c) => `${c.name}, ${c.address}`));
    expect(candidates.length).toBeGreaterThan(0);
    const g = await engine.confirmGoogle(r.id, candidates[0].id);
    console.log("A saved:", { address: g.address, phone: g.phone, hours: g.opening_hours, rating: g.google_rating, photos: g.photos.length, website: g.website });

    await engine.addMenuPhotos(r.id, photos());
    const draft = await engine.readMenuPhotos(r.id);
    console.log("A menu read:", JSON.stringify(draft.map((c) => [c.category, c.items.map((i) => `${i.name} ${i.price}`)])));
    // The owner fixes a price in the table, as on the web.
    const edited = draft.map((c) => ({ ...c, items: c.items.map((i) => (/chai/i.test(i.name) ? { ...i, price: 2.8 } : i)) }));
    await engine.confirmMenu(r.id, cleanMenu(edited));

    const suggested = await engine.suggestMenuAllergens(r.id);
    console.log("A allergens:", suggested.flatMap((c) => c.items.map((i) => `${i.name}: ${i.allergens?.join(", ")}`)));
    // Before confirming, customers see none.
    expect(JSON.stringify(customerSafeMenu(suggested))).not.toContain("allergens");
    await engine.confirmAllergens(r.id, cleanMenu(suggested));

    const { samples, readWebsite } = await engine.draftVoiceOptions(r.id);
    console.log("A voices (website read:", readWebsite, "):", samples.map((v) => `${v.tone}: ${v.sample}`));
    expect(samples).toHaveLength(3);
    await engine.chooseVoice(r.id, samples[0].voice);
    const d = await engine.rewardDefaults(r.id);
    console.log("A reward default:", d);
    await engine.acceptReward(r.id, d.reward, d.cap);

    const early = await engine.finish(r.id);
    expect(early.ok === false && early.needsWhatsapp).toBe(true); // can't finish without WhatsApp
    expect(await link(r.id, "whatsapp:+447700900991")).toMatch(/Linked/);
    const done = await engine.finish(r.id);
    expect(done.ok).toBe(true);
    if (done.ok) {
      await engine.sendFinishSummary(done.restaurant, done.summary, done.qrPack, SANDBOX);
      console.log("A summary:\n" + sent.at(-1)!.text);
      expect(customerSafeMenu(done.restaurant.menu).some((c) => c.items.some((i) => "allergens" in i))).toBe(true);
    }
    timings.web = Date.now() - t0;
  });

  test("B: fully on WhatsApp, then changes by message and UNDO", async () => {
    const t0 = Date.now();
    const owner = "whatsapp:+447700900992";
    const r = await signUp("Dishoom Shoreditch", owner);
    const first = await link(r.id, owner);
    console.log("B >> link\n" + first);
    expect(first).toMatch(/Is this you\?/);
    let reply = await say(r.id, owner, "1");
    console.log("B >> 1\n" + reply);
    expect(reply).toMatch(/Saved from Google/);
    expect(reply).toMatch(/menu/i);
    reply = await say(r.id, owner, "", [
      { url: "https://api.twilio.com/media/page1.jpg", contentType: "image/jpeg" },
      { url: "https://api.twilio.com/media/page2.jpg", contentType: "image/jpeg" },
    ]);
    expect(reply).toMatch(/Got it \(2 so far\)/);
    reply = await say(r.id, owner, "DONE");
    console.log("B >> DONE\n" + reply);
    expect(reply).toMatch(/Is that right\?/);
    reply = await say(r.id, owner, "Masala Chai is £2.80 and remove the onion bhaji");
    console.log("B >> correction\n" + reply);
    expect(reply).toMatch(/2\.80/);
    expect(reply).not.toMatch(/Onion Bhaji/i);
    reply = await say(r.id, owner, "yes");
    console.log("B >> yes\n" + reply);
    expect(reply).toMatch(/Menu saved/);
    reply = await say(r.id, owner, "Gulab jamun: milk, tree nuts, cereals containing gluten");
    console.log("B >> allergen fix\n" + reply);
    reply = await say(r.id, owner, "YES");
    console.log("B >> YES\n" + reply);
    expect(reply).toMatch(/Which sounds most like you/);
    reply = await say(r.id, owner, "2");
    console.log("B >> 2\n" + reply);
    expect(reply).toMatch(/capped at/);
    reply = await say(r.id, owner, "a free mango lassi, and 20%");
    console.log("B >> reward\n" + reply);
    expect(reply).toMatch(/is set up/);
    const s = await engine.state(r.id);
    expect(s.onboarding.completed_at).toBeTruthy();
    expect(s.restaurant).toMatchObject({ signup_reward: "a free mango lassi", discount_cap_percent: 20, active: true });
    timings.whatsapp = Date.now() - t0;

    // After onboarding: normal chat, changes by message, UNDO.
    const ask = async (body: string) => {
      const from = sent.length;
      // Logged first, as the webhook does (the chat reads the conversation from the log).
      const { getSupabase } = await import("@/lib/supabase");
      await getSupabase().from("messages").insert({ restaurant_id: r.id, direction: "inbound", from_number: owner, to_number: SANDBOX, body, status: "received" });
      await handleMessage({ restaurantId: r.id, owner, sandbox: SANDBOX, body, buttonPayload: undefined });
      return sent.slice(from).map((m) => m.text).join("\n---\n");
    };
    const before = (await store.getRestaurant(r.id)).opening_hours;
    reply = await ask("change Friday hours to 11pm");
    console.log("B >> change Friday hours\n" + reply);
    expect((await store.getRestaurant(r.id)).opening_hours.Friday).toMatch(/23:00/);
    reply = await ask("add garlic naan, £3.50");
    console.log("B >> add dish\n" + reply);
    expect(reply).not.toMatch(/Friday/); // only what this message changed
    expect(JSON.stringify((await store.getRestaurant(r.id)).menu)).toMatch(/Garlic Naan/i);
    reply = await ask("UNDO");
    console.log("B >> UNDO\n" + reply);
    expect(JSON.stringify((await store.getRestaurant(r.id)).menu)).not.toMatch(/Garlic Naan/i);
    reply = await ask("UNDO");
    console.log("B >> UNDO\n" + reply);
    expect((await store.getRestaurant(r.id)).opening_hours).toEqual(before);
  });

  test("C: starts on the web, switches to WhatsApp, finishes on the web", async () => {
    const t0 = Date.now();
    const owner = "whatsapp:+447700900993";
    const r = await signUp("Mangal 2", owner);
    const { candidates } = await engine.findOnGoogle(r.id, "Dalston");
    expect(candidates.length).toBeGreaterThan(0);
    await engine.confirmGoogle(r.id, candidates[0].id);
    await engine.addMenuPhotos(r.id, photos());
    await engine.confirmMenu(r.id, cleanMenu(await engine.readMenuPhotos(r.id)));
    // "Finish on WhatsApp instead": linking carries on from the next step.
    let reply = await link(r.id, owner);
    console.log("C >> link\n" + reply);
    expect(reply).toMatch(/carry on from where you got to/);
    expect(reply).toMatch(/Allergens/);
    reply = await say(r.id, owner, "yes");
    expect(reply).toMatch(/Which sounds most like you/);
    reply = await say(r.id, owner, "3");
    expect(reply).toMatch(/capped at/);
    reply = await say(r.id, owner, "WEB");
    expect(reply).toMatch(/onboarding\/setup\?r=/);
    // Back on the web: the reward step, then Finish.
    expect((await engine.state(r.id)).step).toBe("reward");
    const d = await engine.rewardDefaults(r.id);
    await engine.acceptReward(r.id, d.reward, d.cap);
    const done = await engine.finish(r.id);
    expect(done.ok).toBe(true);
    if (done.ok) await engine.sendFinishSummary(done.restaurant, done.summary, done.qrPack, SANDBOX);
    timings.switch = Date.now() - t0;

    // RESET ONBOARDING (test mode, demo restaurant), then it's set up again from scratch.
    const from = sent.length;
    await handleMessage({ restaurantId: r.id, owner, sandbox: SANDBOX, body: "RESET ONBOARDING", buttonPayload: undefined });
    expect(sent.slice(from).map((m) => m.text).join()).toMatch(/Reset/);
    const after = await engine.state(r.id);
    expect(after.step).toBe("google");
    expect(after.restaurant.active).toBe(false);
    expect(after.whatsappLinked).toBe(true);
  });

  test("timings and test restaurants", async () => {
    console.log("Machine time per run (seconds):", Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v / 1000)])));
    // Switched off afterwards so the hourly jobs leave them alone (pages and QR packs still work).
    const { getSupabase } = await import("@/lib/supabase");
    await getSupabase().from("restaurants").update({ active: false }).in("id", made);
    console.log("Test restaurants:", made.join(", "));
  });
});
