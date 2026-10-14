// Onboarding v2: the "Reply to reviews" picks become the profile's examples (and
// every reply follows them), the voice step asks for a website only when there
// isn't one, and only public web addresses are accepted.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { examplePrompt, exampleFor, pickExample } from "@/lib/onboarding/reply-examples";
import { memoryDb } from "./support/memory-db";

const choice = {
  review: "Lovely mixed grill, friendly staff.",
  reviewer: "Sarah M.",
  replies: [
    { style: "Warm and personal", reply: "Thank you Sarah, so glad you loved the mixed grill!" },
    { style: "Short and professional", reply: "Thank you for your kind review." },
    { style: "Upbeat", reply: "Thanks Sarah! See you soon for another grill." },
  ],
};

describe("picking an example", () => {
  test("a number picks that suggestion", () => {
    expect(pickExample(choice, { n: 2 })).toEqual({ review: choice.review, reply: "Thank you for your kind review.", style: "Short and professional", own: false });
  });
  test("the owner's own words win over a number, if they wrote enough", () => {
    expect(pickExample(choice, { n: 1, own: "Cheers Sarah, the grill team will be chuffed!" })).toMatchObject({ reply: "Cheers Sarah, the grill team will be chuffed!", own: true, style: null });
    expect(pickExample(choice, { n: 1, own: "ok" })).toMatchObject({ style: "Warm and personal" });
  });
  test("nothing usable picks nothing", () => {
    expect(pickExample(choice, { n: 4 })).toBeNull();
    expect(pickExample(choice, {})).toBeNull();
  });
});

describe("following the examples", () => {
  const positive = { review: "Great", reply: "Thanks so much!", style: "Warm", own: false };
  const negative = { review: "Cold food", reply: "We're sorry, please call us.", style: "Careful", own: false };
  test("4 to 5 stars follow the positive example, 1 to 3 the negative one", () => {
    const ex = { review_replies: { positive, negative } };
    expect(exampleFor(ex, 5)).toBe(positive);
    expect(exampleFor(ex, 4)).toBe(positive);
    expect(exampleFor(ex, 3)).toBe(negative);
    expect(exampleFor(ex, 1)).toBe(negative);
    expect(exampleFor(ex, null)).toBe(positive);
  });
  test("with only one example, it's used for both", () => {
    expect(exampleFor({ review_replies: { positive } }, 1)).toBe(positive);
    expect(exampleFor({ review_replies: { negative } }, 5)).toBe(negative);
    expect(exampleFor({}, 5)).toBeNull();
    expect(exampleFor(null, 5)).toBeNull();
  });
  test("the prompt line quotes the owner's reply and says not to copy it", () => {
    const line = examplePrompt(positive);
    expect(line).toContain('"""Thanks so much!"""');
    expect(line).toContain("never copy it");
    expect(examplePrompt(null)).toBe("");
  });
});

describe("the engine", () => {
  const R = "44444444-4444-4444-8444-444444444444";
  const logSetting = vi.fn(async () => {});
  let db: ReturnType<typeof memoryDb>;

  beforeEach(() => {
    db = memoryDb({
      restaurants: [{ id: R, name: "Rose & Thyme", website: null, profile_examples: {}, menu: [] }],
      onboarding: [{ restaurant_id: R, steps: {}, data: { replies: { positive: choice, negative: { ...choice, review: "Food was cold." } } } }],
    });
    logSetting.mockClear();
    vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
    vi.doMock("@/lib/audit", async (orig) => ({ ...(await orig<object>()), logSetting }));
  });
  afterEach(() => {
    vi.doUnmock("@/lib/supabase");
    vi.doUnmock("@/lib/audit");
    vi.resetModules();
  });

  test("picks are saved as the profile's examples; the step is done once both are picked", async () => {
    const engine = await import("@/lib/onboarding/engine");
    expect(await engine.chooseReplies(R, { positive: { n: 1 } })).toBe(true);
    expect(db.tables.restaurants[0].profile_examples).toMatchObject({ review_replies: { positive: { style: "Warm and personal" } } });
    expect((db.tables.onboarding[0].steps as Record<string, unknown>).replies).toBeUndefined();
    await engine.chooseReplies(R, { negative: { own: "So sorry it was cold, please ring us so we can put it right." } });
    expect(db.tables.restaurants[0].profile_examples).toMatchObject({
      review_replies: { positive: { style: "Warm and personal" }, negative: { own: true, review: "Food was cold." } },
    });
    expect((db.tables.onboarding[0].steps as Record<string, { status: string }>).replies.status).toBe("done");
    expect(logSetting).toHaveBeenCalledWith(R, "profile_examples", expect.anything(), expect.anything(), expect.any(String));
  });

  test("nothing picked: nothing saved", async () => {
    const engine = await import("@/lib/onboarding/engine");
    expect(await engine.chooseReplies(R, { positive: { n: 9 } })).toBe(false);
    expect(db.tables.restaurants[0].profile_examples).toEqual({});
  });

  test("the website question: asked once, a public address is saved, private ones refused", async () => {
    const engine = await import("@/lib/onboarding/engine");
    const { getRestaurant, getOnboarding } = await import("@/lib/onboarding/store");
    expect(engine.needsWebsiteQuestion(await getRestaurant(R), (await getOnboarding(R))!)).toBe(true);
    expect(await engine.setWebsite(R, "localhost")).toBe(false);
    expect(await engine.setWebsite(R, "http://192.168.1.10/menu")).toBe(false);
    expect(await engine.setWebsite(R, "roseandthyme.co.uk")).toBe(true);
    expect(db.tables.restaurants[0].website).toBe("https://roseandthyme.co.uk");
    expect(engine.needsWebsiteQuestion(await getRestaurant(R), (await getOnboarding(R))!)).toBe(false);
  });

  test("no website: just marked as asked", async () => {
    const engine = await import("@/lib/onboarding/engine");
    await engine.setWebsite(R, null);
    expect(db.tables.restaurants[0].website).toBeNull();
    expect((db.tables.onboarding[0].data as { voice?: { websiteAsked?: boolean } }).voice?.websiteAsked).toBe(true);
  });
});
