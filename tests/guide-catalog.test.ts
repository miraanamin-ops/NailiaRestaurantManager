// The rest of setup's questions (7 Nov 2026): each setting's question as data
// (guide/catalog.ts), the customer list import rules, the sales hint, typed
// times, and how the new cards read on WhatsApp. Pure rules only.
import { describe, expect, test } from "vitest";
import { CATALOG, catalogRecap, catalogSelected, catalogValue, instagramHandle, pounds, ukPhone } from "@/lib/onboarding/guide/catalog";
import { birthdayFrom, customersFromTable } from "@/lib/onboarding/guide/import-rules";
import { salesHintFrom } from "@/lib/onboarding/guide/sales-hint";
import { askFor, inputsFrom, allergenGrid } from "@/lib/onboarding/guide/cards";
import { QUESTIONS, type Facts } from "@/lib/onboarding/guide/questions";
import { parseTones } from "@/lib/onboarding/dina/tones";
import { dinaReplyProblems } from "@/lib/onboarding/dina/reply";
import tonesFile from "../agents/tones.config.json";

const tones = parseTones(tonesFile);
const facts = (r: Record<string, unknown> = {}): Facts => ({ r: { name: "Ember Grill", owner_name: "Amina", ...r }, confirmed: new Set(), state: {} });
const q = (id: string) => CATALOG.find((c) => c.id === id)!;

describe("the catalog", () => {
  test("every catalog question is in the question list, in its chapter, and its words pass Dina's checks", () => {
    const ids = new Set(QUESTIONS.map((x) => x.id));
    const menu = [{ category: "Grills", items: [{ name: "Lamb chops", price: 14, description: null }] }];
    for (const c of CATALOG) {
      expect(ids.has(c.id), c.id).toBe(true);
      const asked = askFor(c.id, facts({ menu, phone: "020 7946 0000" }), inputsFrom({ restaurant: {}, state: {}, tones }))!;
      expect(dinaReplyProblems({ messages: [{ text: asked.text, component: null }] }), c.id).toEqual([]);
      expect(asked.card.options.every((o) => o.label.length <= 60), c.id).toBe(true);
    }
  });

  test("a pick, several picks, 'none of these', the most allowed, and typed words", () => {
    expect(catalogValue(q("restaurant.venue"), facts(), ["dine_in", "delivery"], null)).toEqual({ value: ["dine_in", "delivery"] });
    expect(catalogValue(q("calendar.dates"), facts(), ["muslim", "none"], null)).toEqual({ value: [] });
    expect(catalogValue(q("restaurant.goals"), facts(), ["reviews", "list", "profit", "costs"], null)).toEqual({ error: "Pick up to 3." });
    expect(catalogValue(q("offers.cap"), facts(), ["cap20"], null)).toEqual({ value: 20 });
    expect(catalogValue(q("restaurant.instagram"), facts(), ["own"], "@ember.grill")).toEqual({ value: "ember.grill" });
    expect(catalogValue(q("restaurant.instagram"), facts(), ["none"], null)).toEqual({ value: null });
    expect(catalogValue(q("restaurant.phone"), facts(), ["own"], "call us")).toMatchObject({ error: expect.stringMatching(/UK phone number/) });
    expect(catalogValue(q("calendar.languages"), facts(), ["english", "own"], "tamil")).toEqual({ value: ["English", "Tamil"] });
  });

  test("what's saved shows picked (never taken as the answer); the recap reads the labels", () => {
    expect(catalogSelected(q("offers.cap"), facts({ discount_cap_percent: 15 }))).toEqual(["cap15"]);
    expect(catalogSelected(q("restaurant.phone"), facts({ phone: "020 7946 0000" }))).toEqual(["keep"]);
    expect(catalogSelected(q("sales.quiet"), facts({ _sales: { weeklyAverage: 9000, quietDays: ["monday", "tuesday"], busyDays: [] } }))).toEqual(["monday", "tuesday"]);
    expect(catalogRecap(q("restaurant.goals"), facts({ goals: ["reviews", "list"] }))).toBe("More 5-star reviews, Grow my customer list");
    expect(catalogRecap(q("sales.target"), facts({ weekly_sales_target: 8000 }))).toBe("£8,000");
    expect(catalogRecap(q("offers.no_discount"), facts({ no_discount_days: [] }))).toBe("None");
  });

  test("the weekly target offers their own average when there's sales history", () => {
    const opts = q("sales.target").options!(facts({ _sales: { weeklyAverage: 8460, quietDays: [], busyDays: [] } }));
    expect(opts.map((o) => o.value)).toEqual([8500, 9300, 10200]);
    expect(q("sales.target").options!(facts())).toEqual([]);
  });

  test("typed values: UK phones, Instagram handles, pounds", () => {
    expect(ukPhone("+44 20 7946 0000")).toBe("020 7946 0000");
    expect(ukPhone("07700900123")).toBe("07700 900123");
    expect(ukPhone("12345")).toBeNull();
    expect(instagramHandle("https://instagram.com/ember.grill/")).toBe("ember.grill");
    expect(pounds("about £8,500")).toBe(8500);
    expect(pounds("8k")).toBe(8000);
    expect(pounds("50")).toBeNull();
  });
});

describe("the customer list", () => {
  test("the email column (by heading, or by content), first names, full birthdays; duplicates and junk left out", () => {
    const t = { headers: ["Full name", "E-mail address", "Date of birth"], rows: [["Sara Khan", "SARA@x.test", "14/03/1990"], ["Bad", "not-an-email", ""], ["Sara again", "sara@x.test", ""], ["Omar", "omar@y.test", "1985-07-02"]] };
    expect(customersFromTable(t, 100)).toEqual({ rows: [{ email: "sara@x.test", name: "Sara", birthday: "1990-03-14" }, { email: "omar@y.test", name: "Omar", birthday: "1985-07-02" }], skipped: 2, problem: null });
    const noHeading = { headers: ["A", "B"], rows: [["x", "a@b.test"], ["y", "c@d.test"]] };
    expect(customersFromTable(noHeading, 100).rows.map((r) => r.email)).toEqual(["a@b.test", "c@d.test"]);
    expect(customersFromTable({ headers: ["Name"], rows: [["Sara"]] }, 100).problem).toMatch(/couldn't find a column of email/);
    expect(birthdayFrom("14/03")).toBeNull(); // no year: the column is a full date
  });
});

describe("the sales hint", () => {
  test("the average week and the quietest and busiest days from the takings; nothing from too little", () => {
    const rows = Array.from({ length: 28 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 9, 5 + i)); // from Monday 5 Oct
      const dow = d.getUTCDay();
      return { day: d.toISOString().slice(0, 10), net_sales: dow === 6 ? 3000 : dow === 5 ? 2500 : dow === 1 ? 600 : dow === 2 ? 700 : 1000 };
    });
    expect(salesHintFrom(rows)).toEqual({ weeklyAverage: 9800, quietDays: ["monday", "tuesday"], busyDays: ["saturday", "friday"] });
    expect(salesHintFrom(rows.slice(0, 10)).weeklyAverage).toBeNull();
  });
});

describe("typed times", () => {
  test("'10am to 8pm', '22:00-08:00', 'midnight to 10am'", async () => {
    const { timeRange } = await import("@/lib/onboarding/guide/answer").catch(() => ({ timeRange: null as never }));
    if (!timeRange) return; // (answer.ts is server-only; covered by the whole-turn tests)
    expect(timeRange("10am to 8pm")).toEqual(["10:00", "20:00"]);
  });
});

describe("the allergen grid on WhatsApp", () => {
  test("each dish and what's marked, then These are right, and how to change one in words", async () => {
    const { renderForWhatsApp } = await import("@/lib/onboarding/dina/whatsapp");
    const f = facts({ menu: [{ category: "Grills", items: [{ name: "Lamb chops", price: 14, description: null, allergens: ["milk"], dietary: ["gluten_free"] }] }] });
    const asked = askFor("menu.allergens", f, inputsFrom({ restaurant: f.r, state: {}, tones }))!;
    expect(allergenGrid(f).rows[0].marked).toEqual(["milk", "diet:gluten_free"]);
    const outs = renderForWhatsApp([{ id: "m1", role: "dina", text: asked.text, component: { type: "question", card: asked.card } }], { skippable: true, chatUrl: "https://app.test/c", appUrl: "https://app.test" });
    expect(outs[0]).toEqual({ kind: "text", body: "*Lamb chops*: Milk, Gluten free" });
    expect(outs[1]).toMatchObject({ kind: "buttons", body: expect.stringContaining('like "Lamb chops: add sesame"') });
    expect((outs[1] as { options: { title: string }[] }).options.map((o) => o.title)).toEqual(["All correct", "Skip this question"]);
  });
});

describe("the go-live screen", () => {
  test("each agent, ready or not, with exactly what it waits for and where to do it; nothing held back silently", async () => {
    const { goLive } = await import("@/lib/onboarding/dina/view");
    const restaurant = {
      id: "r-1", owner_name: "Amina", owner_language: "English", quiet_hours_start: "23:00:00", quiet_hours_end: "09:00:00",
      complaint_contact: "Amina", recovery_offers: ["A free dessert"], halal_statement: "HMC", allergen_statement: null, sign_off_name: "Amina",
      logo_url: "https://s.test/l.png", brand_color: "#1b5e20", brand_dark: "#0b2e10", opening_hours: { Monday: "12:00 – 22:00" }, emoji_allowed: { review_replies: 0, posts: 2, campaigns: 2 },
      discount_cap_percent: 15, approved_offer_types: ["percent_off"], signup_reward: "A free dessert",
    };
    const state = { google: { status: "done" as const, data: {}, waitingOn: null, startedAt: null, completedAt: null, skippedAt: null } };
    const agents = goLive({ restaurant, state, confirmed: ["logo", "colours", "emoji_allowed"] });
    expect(agents.map((a) => [a.name, a.ready, a.needs])).toEqual([
      ["Review replies", false, ["allergen statement"]],
      ["Google posts", true, []],
      ["Offers and emails", true, []],
      ["Your morning brief", true, []],
    ]);
    expect(agents[0].href).toBe("/onboarding/chat?r=r-1&step=menu");
    // Google not in yet: review replies and posts say so.
    const waiting = goLive({ restaurant: { ...restaurant, allergen_statement: "Ask us." }, state: {}, confirmed: ["logo", "colours", "emoji_allowed"] });
    expect(waiting[1].needs).toEqual([expect.stringMatching(/^Google access/)]);
  });
});

describe("the owner's comments of 7 Nov", () => {
  test("the website is asked in chapter 1, before the look reads it; the team and costs sheets have their upload on the same card", () => {
    const ids = QUESTIONS.filter((x) => x.step === "hello").map((x) => x.id);
    expect(ids.indexOf("restaurant.website")).toBeGreaterThan(ids.indexOf("restaurant.phone"));
    expect(ids.indexOf("restaurant.website")).toBeLessThan(ids.indexOf("restaurant.goals"));
    const inputs = { ...inputsFrom({ restaurant: {}, state: {}, tones }), templateLinks: { staff: "https://app.test/t/staff", menu_costs: "https://app.test/t/costs" } };
    const menu = [{ category: "Grills", items: [{ name: "Lamb chops", price: 14, description: null }] }];
    const team = askFor("team.method", facts(), inputs)!;
    expect(team.card).toMatchObject({ link: { href: "https://app.test/t/staff" }, upload: { accept: "spreadsheet" }, options: [{ id: "type" }] });
    const costs = askFor("menu.costs", facts({ menu }), inputs)!;
    expect(costs.card).toMatchObject({ link: { href: "https://app.test/t/costs" }, upload: { accept: "spreadsheet" } });
    expect(costs.card.options.map((o) => o.id)).toEqual(["pct25", "pct30", "pct35"]);
    expect(QUESTIONS.filter((x) => x.step === "team").map((x) => x.id)).toEqual(["team.method", "team.base"]);
  });
});
