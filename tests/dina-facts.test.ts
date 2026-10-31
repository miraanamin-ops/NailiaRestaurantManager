// Phase 7: steps 4 to 6. The rules as plain code (facts-content.ts), the cards on
// the web and WhatsApp, then whole turns on the in-memory database: making it
// right (offers within the discount cap), the menu (read from a photo with the
// reading's doubts flagged, corrected, confirmed, then allergens dish by dish:
// code's own cards, no "accept all", "not sure" stays unknown and is never shown
// to customers or Dina), and hours and FAQs (halal only in the owner's words),
// plus files from the web chat. Claude is a stand-in.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { allergenProgress, dishKey, faqsLeft, hoursCard, hoursFromNotes, menuCard, nextAllergenDish, offerProblems } from "@/lib/onboarding/dina/facts-content";
import { stepDataForPrompt } from "@/lib/onboarding/dina/prompt";
import { dinaReplyProblems } from "@/lib/onboarding/dina/reply";
import { renderForWhatsApp } from "@/lib/onboarding/dina/whatsapp";
import { customerSafeMenu, type MenuCategory } from "@/lib/onboarding/profile-data";
import { memoryDb } from "./support/memory-db";

const MENU: MenuCategory[] = [
  { category: "Grills", items: [{ name: "Lamb chops", price: 14, description: null, allergens: ["milk"], allergens_confirmed: false }, { name: "Mixed grill", price: 18, description: null, allergens: [], allergens_confirmed: false }] },
  { category: "Sides", items: [{ name: "Chips", price: 3.5, description: null, allergens: [], allergens_confirmed: false }] },
];

describe("the rules", () => {
  test("recovery offers within the cap are fine; over it, or a whole free meal, refused with the reason", () => {
    expect(offerProblems(["Invite them back for a free dessert", "10% off their next visit", "Ask them to call us"], 15)).toEqual([]);
    expect(offerProblems(["20% off next time"], 15)).toEqual(['"20% off next time" is more than your 15% discount cap.']);
    expect(offerProblems(["A free meal on us"], 15)).toEqual(['"A free meal on us" is a whole meal free, which is more than your 15% discount cap.']);
    expect(offerProblems(["A full refund"], 15)).toHaveLength(1);
  });

  test("hours as the owner says them, tidied; anything unclear named", () => {
    expect(hoursFromNotes({ Monday: "12-10pm", sunday: "closed" })).toEqual({ hours: { Monday: "12:00 – 22:00", Sunday: "Closed" }, problems: [] });
    expect(hoursFromNotes({ Funday: "9-5", Tuesday: "lunchtime" }).problems).toEqual(['"Funday" isn\'t a day of the week.', 'Tuesday\'s hours ("lunchtime") aren\'t clear.']);
    expect(hoursCard({ Monday: "12:00 – 22:00" }).fields.map((f) => [f.label, f.value])).toEqual([
      ["Monday", "12:00 – 22:00"],
      ["Tuesday", null],
      ["Wednesday", null],
      ["Thursday", null],
      ["Friday", null],
      ["Saturday", null],
      ["Sunday", null],
    ]);
  });

  test("the menu card: a row per dish with price and section, the reading's doubts flagged", () => {
    expect(menuCard(MENU, { [dishKey("Grills", "Mixed grill")]: "price unclear" }).fields.map((f) => f.value)).toEqual(["£14.00 · Grills", "£18.00 · Grills (price unclear)", "£3.50 · Sides"]);
  });

  test("allergens: the next dish not checked and not 'not sure'; the count", () => {
    const menu = structuredClone(MENU);
    menu[0].items[0].allergens_confirmed = true;
    expect(nextAllergenDish(menu, [])).toMatchObject({ name: "Mixed grill", key: "grills::mixed grill" });
    expect(nextAllergenDish(menu, ["grills::mixed grill"])).toMatchObject({ name: "Chips" });
    expect(allergenProgress(menu, ["grills::mixed grill"])).toEqual({ total: 3, confirmed: 1, unknown: 1, left: 1 });
  });

  test("seven common questions; the ones left", () => {
    expect(faqsLeft({ halal: "Yes, HMC certified", parking: "(not answered)" }).map((t) => t.id)).toEqual(["delivery", "bookings", "accessibility", "kids", "private_hire"]);
  });

  test("Dina sees the draft menu as a count and its sections: no dishes, no allergen guesses", () => {
    const shown = JSON.stringify(stepDataForPrompt("menu", { draft: MENU, unsure: {} }));
    expect(shown).toContain('"draft":{"dishes":3,"sections":["Grills","Sides"]}');
    expect(shown).not.toMatch(/Lamb|milk/);
  });

  test("customers (and Dina's writing for them) only ever get confirmed allergens", () => {
    const menu = structuredClone(MENU);
    menu[0].items[0].allergens_confirmed = true;
    menu[0].items[1].allergens = ["sesame"];
    const safe = customerSafeMenu(menu);
    expect(safe[0].items[0]).toMatchObject({ allergens: ["milk"] });
    expect(safe[0].items[1]).not.toHaveProperty("allergens");
  });
});

describe("the cards on WhatsApp", () => {
  const M = "11111111-1111-4111-8111-111111111111";
  const wa = { skippable: true, chatUrl: "https://app.test/c", appUrl: "https://app.test" };
  const actions = [
    { id: "allergen_ok", label: "That's right" },
    { id: "allergen_change", label: "Change it" },
    { id: "allergen_unsure", label: "Not sure" },
    { id: "allergen_later", label: "Do the rest later", short: "Rest later" },
  ];

  test("an allergen card: the dish and its suggestion, then the four answers (and skip) as a list", () => {
    const [out] = renderForWhatsApp([{ id: M, role: "dina", text: "Let's check allergens.", component: { type: "dish_check", dish: "Lamb chops", section: "Grills", suggested: ["milk"], position: 1, total: 3, actions } }], wa);
    expect(out).toMatchObject({ kind: "list", body: expect.stringContaining("*Lamb chops* (Grills), dish 1 of 3. Suggested: milk.") });
    expect(out.kind === "list" && out.options.map((o) => o.title)).toEqual(["That's right", "Change it", "Not sure", "Rest later", "Skip for now"]);
  });

  test("a whole menu goes in as many messages as it takes, then the question with its buttons", () => {
    const big: MenuCategory[] = [{ category: "Mains", items: Array.from({ length: 80 }, (_, i) => ({ name: `Dish number ${i + 1} with a longish name`, price: 9.5, description: null })) }];
    const out = renderForWhatsApp([{ id: M, role: "dina", text: "Is this right?", component: { type: "confirmation", card: menuCard(big) } }], { ...wa, skippable: false });
    expect(out.length).toBeGreaterThan(2);
    expect(out.every((o) => o.body.length <= 1600)).toBe(true);
    expect(out.at(-1)).toMatchObject({ kind: "buttons", body: "Is this right?\n\nReply 1 or 2" });
    expect(out.slice(0, -1).map((o) => o.body).join("\n").match(/Dish number/g)).toHaveLength(80);
  });
});

// ---------- Whole turns, on the in-memory database ----------

const R = "dddddddd-0000-4000-8000-0000000000a7";
let db: ReturnType<typeof memoryDb>;
const callDina = vi.fn();
const parse = vi.fn();
const suggestAllergens = vi.fn();
const applyMenuCorrection = vi.fn();
const usage = { purpose: "turn", model: "claude-sonnet-5-5", tokens: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.003 } };
const answer = (messages: { text: string; component?: unknown }[], extra: Record<string, unknown> = {}) => ({ reply: { messages: messages.map((m) => ({ component: null, ...m })), ...extra }, calls: [usage], toolCalls: [], attempts: 1 });
const tick = () => new Promise((r) => setTimeout(r, 3));

beforeEach(() => {
  vi.resetModules();
  [callDina, parse, suggestAllergens, applyMenuCorrection].forEach((f) => f.mockReset());
  db = memoryDb(
    {
      restaurants: [{ id: R, name: "Ember Grill", owner_name: "Amina", active: false, is_demo: true, discount_cap_percent: 15, opening_hours: { Monday: "12:00 – 22:00" }, menu: [], faqs: {}, profile_version: 0, recovery_offers: null, complaint_contact: null, halal_statement: null }],
      onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "make_it_right", channel_last_used: "web", started_at: "2026-10-31T10:00:00.000Z", completed_at: null }],
      onboarding_steps: ["hello", "google", "tone"].map((k) => ({ restaurant_id: R, step_key: k, status: "done", data: {}, completed_at: "2026-10-31T10:05:00.000Z" })),
      onboarding_messages: [],
      setup_gaps: [],
      onboarding_ai_usage: [],
      audit_log: [],
      profile_versions: [],
      google_connections: [],
      rate_limits: [],
    },
    { unique: ["onboarding_messages.external_id"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "sent" }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, structuredClone(fields)),
  }));
  vi.doMock("@/lib/onboarding/dina/call", async (orig) => ({ ...(await orig<object>()), callDina, routeStep: async () => ({ step: null, call: usage }) }));
  vi.doMock("@/lib/claude", async (orig) => ({ ...(await orig<object>()), claude: () => ({ beta: { messages: { parse } } }) }));
  vi.doMock("@/lib/onboarding/ai", async (orig) => ({ ...(await orig<object>()), suggestAllergens, applyMenuCorrection }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/builder-alerts", "@/lib/ops/menu", "@/lib/onboarding/dina/call", "@/lib/claude", "@/lib/onboarding/ai"]) vi.doUnmock(m);
});

const r = () => db.tables.restaurants[0];
const step = (key: string) => db.tables.onboarding_steps.find((s) => s.step_key === key);
const onStep = (key: string) => {
  db.tables.onboarding_sessions[0].current_step = key;
};
const turn = async (text: string) => {
  const { dinaTurn } = await import("@/lib/onboarding/dina/turn");
  const out = await dinaTurn({ restaurantId: R, channel: "web", event: "message", text, externalId: `t${Math.random()}` });
  await tick();
  return out;
};
const tool = async (name: string, input: unknown) => {
  const { runTool, TOOLS } = await import("@/lib/onboarding/dina/tools");
  return runTool({ restaurantId: R, channel: "web" }, TOOLS, name, input);
};
const tap = async (messageId: string, choiceId: string) => {
  const { handleAnswer } = await import("@/lib/onboarding/dina/answers");
  return handleAnswer({ restaurantId: R, messageId, choiceId, channel: "web" });
};
const lastDina = () => db.tables.onboarding_messages.filter((m) => m.role === "dina").at(-1)!;

describe("step 4, making it right", () => {
  test("an offer over the discount cap is refused with the reason; within it, saved to the profile and the step is done", async () => {
    expect(await tool("save_make_it_right", { offers: ["25% off next time"], handler: "Amina, the owner" })).toEqual({ ok: false, text: expect.stringMatching(/"25% off next time" is more than your 15% discount cap/) });
    expect(r().recovery_offers).toBeNull();
    expect(await tool("save_make_it_right", { offers: ["Invite them back for a free dessert", "Ask them to call us"], handler: "Amina, the owner", contact: "020 7946 0000" })).toMatchObject({ ok: true });
    expect(r()).toMatchObject({ recovery_offers: ["Invite them back for a free dessert", "Ask them to call us"], complaint_contact: "Amina, the owner, 020 7946 0000" });
    expect(step("make_it_right")?.status).toBe("done");
    expect(db.tables.onboarding_sessions[0].current_step).toBe("menu");
    expect(db.tables.audit_log.map((a) => a.detail)).toEqual(expect.arrayContaining([expect.stringMatching(/recovery offers/), expect.stringMatching(/contact for complaints/)]));
  });
});

describe("step 5, the menu", () => {
  beforeEach(() => {
    onStep("menu");
    db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "make_it_right", status: "skipped", data: {} });
  });

  test("a photo is read into a draft, the reading's doubts flagged and passed on; the cost is logged", async () => {
    await db.client.storage.from("onboarding-uploads").upload(`${R}/menu/SM1-1.jpg`, Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { contentType: "image/jpeg" });
    parse.mockResolvedValueOnce({
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 3000, output_tokens: 400 },
      parsed_output: { categories: [{ category: "Grills", items: [{ name: "Lamb chops", price: 14, description: null, unsure: null }, { name: "Mixed grill", price: 18, description: null, unsure: "price unclear" }] }] },
    });
    const { readMenuFiles } = await import("@/lib/onboarding/dina/menu-step");
    const note = await readMenuFiles(R, [{ type: "file", path: `${R}/menu/SM1-1.jpg`, kind: "photo", contentType: "image/jpeg", bytes: 4 }]);
    expect(note).toMatch(/^Code read the menu: 2 dishes in 1 section \(Grills\)\. Show it with editable_card menu[\s\S]*wasn't sure about: Mixed grill: price unclear/);
    expect(parse.mock.calls[0][0].messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
    expect(step("menu")?.data).toMatchObject({ draft: [{ category: "Grills", items: [{ name: "Lamb chops", allergens: [], allergens_confirmed: false }, { name: "Mixed grill" }] }], unsure: { "grills::mixed grill": "price unclear" } });
    expect(db.tables.onboarding_ai_usage).toEqual([expect.objectContaining({ purpose: "extract", step_key: "menu" })]);
  });

  test("a PDF goes to Claude as a document; a spreadsheet isn't read as a menu", async () => {
    await db.client.storage.from("onboarding-uploads").upload(`${R}/menu/w-1.pdf`, Buffer.from("%PDF-1.7"), { contentType: "application/pdf" });
    parse.mockResolvedValueOnce({ model: "claude-sonnet-5-5", usage: {}, parsed_output: { categories: [{ category: "Menu", items: [{ name: "Chips", price: 3.5, description: null, unsure: null }] }] } });
    const { readMenuFiles } = await import("@/lib/onboarding/dina/menu-step");
    await readMenuFiles(R, [{ type: "file", path: `${R}/menu/w-1.pdf`, kind: "pdf", contentType: "application/pdf", bytes: 8 }]);
    expect(parse.mock.calls[0][0].messages[0].content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    expect(await readMenuFiles(R, [{ type: "file", path: `${R}/menu/x.csv`, kind: "csv", contentType: "text/csv", bytes: 8 }])).toMatch(/none is a photo or a PDF/);
  });

  test("confirmed: saved with suggested allergens, all unconfirmed; then dish by dish, code's own cards, no Claude call per dish", async () => {
    db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "menu", status: "in_progress", data: { draft: structuredClone(MENU).map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, allergens: [] })) })), unsure: {} } });
    suggestAllergens.mockImplementation(async (menu: MenuCategory[]) => menu.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, allergens: i.name === "Lamb chops" ? ["milk", "mustard"] : [], allergens_confirmed: false })) })));
    db.tables.onboarding_messages.push({ id: "aaaaaaaa-0000-4000-8000-000000000001", restaurant_id: R, role: "dina", body: "Is this right?", parts: [{ type: "editable_card", card: "menu" }], created_at: "2026-10-31T10:10:00Z" });
    expect(await tap("aaaaaaaa-0000-4000-8000-000000000001", "confirm")).toMatch(/Code saved their menu \(3 dishes\)\. Next, allergens/);
    expect(r().menu[0].items[0]).toMatchObject({ name: "Lamb chops", allergens: ["milk", "mustard"], allergens_confirmed: false });
    expect(step("menu")?.data.draft).toBeNull();

    // Dina shows the first card: code fixes the dish on it.
    callDina.mockResolvedValueOnce(answer([{ text: "Now allergens, one dish at a time.", component: { type: "allergen_check" } }]));
    await turn("ok");
    const first = lastDina();
    expect(first.parts).toEqual([{ type: "allergen_check", dish: "grills::lamb chops" }]);

    // "That's right": confirmed, and code's next card comes straight back.
    const next = await tap(first.id, "allergen_ok");
    expect(next).toEqual({ reply: [{ text: expect.stringMatching(/^Mixed grill \(Grills\), dish 2 of 3\. My suggestion from its name: none of the 14\. That's only a guess, so is it right\?$/), component: { type: "allergen_check" } }] });
    expect(dinaReplyProblems({ messages: (next as { reply: { text: string; component: null }[] }).reply })).toEqual([]);
    expect(r().menu[0].items[0].allergens_confirmed).toBe(true);
    const { codeTurn } = await import("@/lib/onboarding/dina/turn");
    await codeTurn({ restaurantId: R, channel: "web", text: "That's right", externalId: "tap-1", messages: (next as { reply: never[] }).reply });
    const second = lastDina();
    expect(second.parts).toEqual([{ type: "allergen_check", dish: "grills::mixed grill" }]);
    expect(callDina).toHaveBeenCalledTimes(1); // the second card cost no Claude call
    expect(await codeTurn({ restaurantId: R, channel: "web", text: "That's right", externalId: "tap-1", messages: (next as { reply: never[] }).reply })).toEqual({ duplicate: true });

    // "Not sure": stays unknown (never shown to customers), and on to the next.
    expect(await tap(second.id, "allergen_unsure")).toMatchObject({ reply: [{ text: expect.stringMatching(/^Chips \(Sides\)/) }] });
    expect(customerSafeMenu(r().menu)[0].items[1]).not.toHaveProperty("allergens");

    // "Change it": Dina asks, then saves exactly what they say; the last dish done, the step half done (one unknown).
    expect(await tap(second.id, "allergen_change")).toMatch(/change the allergens for this dish/);
    expect(await tool("set_allergens", { dish: "chips", allergens: [] })).toMatchObject({ ok: true, text: expect.stringMatching(/^Saved chips: none of the 14 \(confirmed\)\. Every dish is dealt with: 2 confirmed, 1 left as unknown/) });
    expect(step("menu")?.status).toBe("partial");
    expect(db.tables.setup_gaps).toEqual(expect.arrayContaining([expect.objectContaining({ step_key: "menu" })]));
    expect(await tool("set_allergens", { dish: "Samosa", allergens: ["milk"] })).toMatchObject({ ok: false });
  });

  test("a change in their words goes to the draft (before it's saved)", async () => {
    db.tables.onboarding_steps.push({ restaurant_id: R, step_key: "menu", status: "in_progress", data: { draft: structuredClone(MENU) } });
    applyMenuCorrection.mockImplementation(async (menu: MenuCategory[]) => menu.map((c) => ({ ...c, items: c.items.map((i) => (i.name === "Mixed grill" ? { ...i, price: 19 } : i)) })));
    expect(await tool("correct_menu", { instruction: "Mixed grill is £19" })).toMatchObject({ ok: true });
    expect((step("menu")?.data.draft as MenuCategory[])[0].items[1].price).toBe(19);
    expect(r().menu).toEqual([]); // not saved until they confirm
  });
});

describe("step 6, hours and FAQs", () => {
  beforeEach(() => onStep("hours_faqs"));

  test("hours she heard become the card's draft; 'Looks right' saves them; the seven answers finish the step (halal in their words)", async () => {
    callDina.mockResolvedValueOnce(answer([{ text: "Here's what I have.", component: { type: "editable_card", card: "hours" } }], { hours_notes: { Friday: "12-11pm", Sunday: "closed" } }));
    await turn("We're open till 11 on Fridays and closed Sundays");
    expect(step("hours_faqs")?.data.hours_draft).toEqual({ Monday: "12:00 – 22:00", Friday: "12:00 – 23:00", Sunday: "Closed" });
    expect(await tap(lastDina().id, "confirm")).toMatch(/Next, the common questions: 7 left[\s\S]*Code saved their opening hours/);
    expect(r().opening_hours).toEqual({ Monday: "12:00 – 22:00", Friday: "12:00 – 23:00", Sunday: "Closed" });

    callDina.mockResolvedValueOnce(answer([{ text: "Got it. Is there parking nearby?" }], { faq_notes: { halal: "Yes, all our meat is HMC certified" } }));
    await turn("yes all HMC certified");
    expect(r()).toMatchObject({ faqs: { halal: "Yes, all our meat is HMC certified" }, halal_statement: "Yes, all our meat is HMC certified" });
    callDina.mockResolvedValueOnce(
      answer([{ text: "Thanks, that's everything." }], { faq_notes: { parking: "Free car park behind us", delivery: "Deliveroo and collection", bookings: "(not answered)", accessibility: "Step-free", kids: "High chairs", private_hire: "Upstairs room for 30" } }),
    );
    await turn("parking behind, deliveroo, step free, high chairs, room upstairs for 30");
    expect(step("hours_faqs")?.status).toBe("done");
    expect(Object.keys(r().faqs)).toHaveLength(7);
  });

  test("an unclear day isn't saved; notes after the step is finished change nothing", async () => {
    callDina.mockResolvedValueOnce(answer([{ text: "Sorry, which hours on Tuesday?" }], { hours_notes: { Tuesday: "lunchtime" } }));
    await turn("tuesdays lunchtime only");
    expect(step("hours_faqs")?.data.hours_draft).toBeUndefined();
  });
});

describe("files from the web chat", () => {
  test("only this restaurant's incoming folder; checked by their bytes; anything else removed and refused", async () => {
    const storage = db.client.storage.from("onboarding-uploads");
    await storage.upload(`${R}/incoming/a.jpg`, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]), {});
    await storage.upload(`${R}/incoming/b.pdf`, Buffer.from("<html>not a pdf</html>"), {});
    const { checkUploadedFiles } = await import("@/lib/onboarding/dina/uploads-store");
    const out = await checkUploadedFiles(R, [`${R}/incoming/a.jpg`, `${R}/incoming/b.pdf`, "other-restaurant/incoming/c.jpg", `${R}/incoming/../menu/x.jpg`]);
    expect(out.saved).toEqual([expect.objectContaining({ path: `${R}/incoming/a.jpg`, kind: "photo" })]);
    expect(out.refused.map((x) => x.reason)).toEqual(["type", "failed", "failed"]);
    expect([...db.files.keys()]).toEqual([`onboarding-uploads/${R}/incoming/a.jpg`]); // the bad one is gone
  });
});

describe("never 'saved' when nothing was", () => {
  const reply = (text: string, extra: Record<string, unknown> = {}) => ({ messages: [{ text, component: null }], ...extra });
  test("a claim with no tool, no notes and nothing code did is sent back", async () => {
    const { unsavedClaim } = await import("@/lib/onboarding/dina/reply");
    expect(unsavedClaim(reply("Thanks, I've noted you as the contact."), { toolSaved: false, codeActed: false })).toMatch(/It says "I've noted", but nothing was saved this turn/);
    expect(unsavedClaim(reply("Lovely, that's saved."), { toolSaved: false, codeActed: false })).toMatch(/that's saved/);
    expect(unsavedClaim(reply("That's everything I need."), { toolSaved: false, codeActed: false })).not.toBeNull();
  });
  test("fine when a tool saved, code acted, notes carry it, or nothing is claimed", async () => {
    const { unsavedClaim } = await import("@/lib/onboarding/dina/reply");
    expect(unsavedClaim(reply("That's saved."), { toolSaved: true, codeActed: false })).toBeNull();
    expect(unsavedClaim(reply("That's saved."), { toolSaved: false, codeActed: true })).toBeNull();
    expect(unsavedClaim(reply("Noted that, thanks.", { hours_notes: { Monday: "12-10pm" } }), { toolSaved: false, codeActed: false })).toBeNull();
    expect(unsavedClaim(reply("What time do you close on Fridays?"), { toolSaved: false, codeActed: false })).toBeNull();
  });
});
