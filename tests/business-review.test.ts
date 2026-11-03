// The business review after onboarding (lib/review, supabase/058), step 1: it
// starts once per restaurant and only after setup is complete; its parts run
// side by side and a failed one drops its section without blocking the rest;
// it goes when every part is in or at the 10-minute deadline, once; the 24-hour
// window decides session message, template, or waiting (with the link emailed).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { memoryDb } from "./support/memory-db";
import {
  aboutTime,
  autoReviewAllowed,
  canClaimSend,
  fallbackMessage,
  factsFromParts,
  firstParts,
  messageProblems,
  partsAfter,
  readyToSend,
  sectionLines,
  type ReviewFacts,
} from "@/lib/review/rules";
import type { Part } from "@/lib/review/config";

const R = "eeeeeeee-0000-4000-8000-000000000058";
const REAL = "eeeeeeee-0000-4000-8000-000000000059";
const OWNER = "whatsapp:+447700900158";
const SANDBOX = "whatsapp:+14155238886";

// ---------- Pure rules ----------

const base: ReviewFacts = { firstName: "Sam", restaurant: "Ember & Spice", link: "https://app.test/review/ember-spice", connected: true };
const full: ReviewFacts = {
  ...base,
  rating: { rating: 4.4, count: 132, nearby: { average: 4.2, n: 5 } },
  backlog: { unanswered: 22, drafted: 22 },
  profile: { score: 64, fixes: 5, examples: ["A longer description", "Your menu link"] },
  themes: { praises: ["The lamb chops", "Friendly staff", "Big portions"], complaint: { label: "Waiting times", count: 7 } },
  events: { names: ["Bonfire Night", "Black Friday"], drafted: 2, emailsHeld: true },
  poster: true,
  minutesSaved: 215,
};

describe("rules", () => {
  test("automatic only for test and demo sites until it's opened; then everyone", () => {
    expect(autoReviewAllowed({ is_demo: false, is_test: false }, false)).toBe(false);
    expect(autoReviewAllowed({ is_demo: true }, false)).toBe(true);
    expect(autoReviewAllowed({ is_test: true }, false)).toBe(true);
    expect(autoReviewAllowed({ is_demo: false }, true)).toBe(true);
  });

  test("ready when every part has finished, or at the deadline", () => {
    const now = new Date("2026-11-03T12:05:00Z");
    const deadline = new Date("2026-11-03T12:10:00Z");
    expect(readyToSend([{ part: "rivals", status: "done" }, { part: "poster", status: "queued" }], now, deadline)).toBe(false);
    expect(readyToSend([{ part: "rivals", status: "done" }, { part: "poster", status: "failed" }], now, deadline)).toBe(true);
    expect(readyToSend([{ part: "rivals", status: "queued" }], deadline, deadline)).toBe(true);
  });

  test("a send can be claimed while running, or again only once a claim is stale", () => {
    const now = new Date("2026-11-03T12:10:00Z");
    expect(canClaimSend({ status: "running", claimed_at: null }, now)).toBe(true);
    expect(canClaimSend({ status: "sending", claimed_at: "2026-11-03T12:08:00Z" }, now)).toBe(false);
    expect(canClaimSend({ status: "sending", claimed_at: "2026-11-03T12:01:00Z" }, now)).toBe(true);
    expect(canClaimSend({ status: "sent", claimed_at: null }, now)).toBe(false);
  });

  test("parts after the review sync: a failed sync skips backlog and themes, profile still runs", () => {
    const all: Part[] = ["reviews_sync", "backlog", "themes", "profile", "rivals", "events", "poster"];
    expect(firstParts(all)).toEqual(["reviews_sync", "rivals", "events", "poster"]);
    expect(partsAfter("reviews_sync", "done", all)).toEqual({ run: ["backlog", "themes", "profile"], skip: [] });
    expect(partsAfter("reviews_sync", "failed", all)).toEqual({ run: ["profile"], skip: ["backlog", "themes"] });
    // Without the sync built, the profile isn't waiting on it.
    expect(firstParts(["profile", "poster"])).toEqual(["profile", "poster"]);
  });

  test("the message written by code, in the agreed shape", () => {
    expect(fallbackMessage(full)).toBe(
      [
        "Thanks for finishing setup, Sam. I've reviewed Ember & Spice and here's what I found:",
        "",
        "⭐ 4.4 from 132 Google reviews. Nearby average: 4.2 across 5 local rivals.",
        "💬 22 reviews have no reply. I've drafted replies to all of them.",
        "📋 Your Google profile scores 64/100. 5 fixes are ready, e.g. a longer description and your menu link.",
        "👍 Customers love: the lamb chops, friendly staff and big portions.",
        "👎 Most common complaint: waiting times (7 reviews).",
        "📅 Coming up: Bonfire Night and Black Friday. Campaigns drafted (the emails wait until you have subscribers).",
        "🪧 Your table QR poster is ready to print.",
        "",
        "That's about 3.5 hours of work done. Tap Let's go or reply GO and I'll take you through it, one thing at a time. Full review: https://app.test/review/ember-spice",
      ].join("\n"),
    );
    expect(fallbackMessage(full).length).toBeLessThan(1000);
  });

  test("empty and thin states have their own words", () => {
    const lines = sectionLines({
      ...base,
      rating: { rating: 4.8, count: 4, nearby: null },
      backlog: { unanswered: 0, drafted: 0 },
      profile: { score: 100, fixes: 0, examples: [] },
      events: { names: [], drafted: 0, emailsHeld: false },
    });
    expect(lines).toEqual([
      "⭐ 4.8 from 4 Google reviews.",
      "💬 You've replied to every review. Nice work.",
      "📋 Your Google profile scores 100/100. Nothing to fix.",
      "📅 Nothing big in the next 30 days. I'll plan around your quiet days instead.",
    ]);
    expect(sectionLines({ ...base, profile: { score: 93, fixes: 1, examples: ["Your logo"] } })).toEqual(["📋 Your Google profile scores 93/100, one of the best I've seen. 1 small fix is ready."]);
    expect(sectionLines({ ...base, profile: { score: 91, fixes: 0, examples: [] } })).toEqual(["📋 Your Google profile scores 91/100, one of the best I've seen."]);
    expect(sectionLines({ ...base, backlog: { unanswered: 1, drafted: 1 } })).toEqual(["💬 1 review has no reply. I've drafted a reply."]);
  });

  test("not connected to Google: the Connect Google line", () => {
    const text = fallbackMessage({ ...base, connected: false, rating: { rating: 4.1, count: 80, nearby: { average: 4.3, n: 3 } } });
    expect(text).toContain("Connect Google and I can reply to your reviews and fix your profile for you.");
    expect(text).toContain("across 3 local rivals");
  });

  test("about: to the nearest half hour, minutes under an hour", () => {
    expect(aboutTime(215)).toBe("about 3.5 hours");
    expect(aboutTime(60)).toBe("about 1 hour");
    expect(aboutTime(44)).toBe("about 45 minutes");
  });

  test("the number check: code's own message passes; a changed, added or dropped number fails", () => {
    const text = fallbackMessage(full);
    expect(messageProblems(text, full)).toEqual([]);
    expect(messageProblems(text.replace("22 reviews have no reply", "25 reviews have no reply"), full).join(" ")).toMatch(/25/);
    expect(messageProblems(text.replace("from 132 Google", "from 132 Google (top 10%)"), full).join(" ")).toMatch(/10/);
    expect(messageProblems(text.replace(" (7 reviews)", ""), full).join(" ")).toMatch(/7 from the data is missing/);
    expect(messageProblems(text.replace("🪧 Your table QR poster is ready to print.\n", ""), full).join(" ")).toMatch(/🪧/);
    expect(messageProblems(text + "\n📋 Profile: great", { ...full, profile: undefined }).join(" ")).toMatch(/no data/);
    expect(messageProblems("x".repeat(1001), full).join(" ")).toMatch(/1001 characters/);
  });

  test("facts come only from finished parts; Google sections need Google connected", () => {
    const parts = [
      { part: "reviews_sync" as const, status: "done" as const, result: { connected: true, rating: 4.4, total: 132, synced: 60, unanswered: 22 } },
      { part: "backlog" as const, status: "failed" as const, result: null },
      { part: "rivals" as const, status: "done" as const, result: { ours: { rating: 4.3, count: 130 }, nearby: { average: 4.2, n: 5 } } },
      { part: "poster" as const, status: "queued" as const, result: { ready: true } },
    ];
    const f = factsFromParts(parts, base);
    expect(f.rating).toEqual({ rating: 4.4, count: 132, nearby: { average: 4.2, n: 5 } });
    expect(f.backlog).toBeUndefined();
    // Still going, with a result so far: that counts (the reply backlog in batches).
    expect(f.poster).toBe(true);
    const off = factsFromParts([{ part: "backlog", status: "done", result: { unanswered: 3, drafted: 3, positiveReady: 3, negative: 0 } }, ...parts], { ...base, connected: false });
    expect(off.backlog).toBeUndefined();
    // Not connected: our rating from Places.
    expect(factsFromParts([parts[2]], { ...base, connected: false }).rating?.rating).toBe(4.3);
  });
});

// ---------- The job, on the in-memory database ----------

let db: ReturnType<typeof memoryDb>;
let queued: { type: string; key: string; payload: Record<string, unknown>; runAt?: Date }[];
const sent: { kind: string; body: string }[] = [];
const alerts: string[] = [];
const emails: string[] = [];
let windowOpen = true;
let sandbox = true;

beforeEach(() => {
  vi.resetModules();
  queued = [];
  sent.length = 0;
  alerts.length = 0;
  emails.length = 0;
  windowOpen = true;
  sandbox = true;
  // No Claude in the job tests: the message is code's own (the wording has its own tests below).
  process.env.AGENTS_LIVE_ALLOWED = "false";
  db = memoryDb(
    {
      restaurants: [
        { id: R, name: "Ember & Spice", slug: "ember-spice", owner_name: "Sam Ahmed", is_demo: true, is_test: true, owner_whatsapp: OWNER, whatsapp_from: SANDBOX, owner_email: "sam@example.com" },
        { id: REAL, name: "Real Grill", slug: "real-grill", owner_name: "Ali", is_demo: false, owner_whatsapp: "whatsapp:+447700900159", whatsapp_from: SANDBOX },
      ],
      business_reviews: [],
      business_review_parts: [],
      time_saved_log: [],
      audit_log: [],
      messages: [],
    },
    { unique: ["business_reviews.restaurant_id"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.test" }));
  vi.doMock("@/lib/queue/store", () => ({
    enqueue: async (input: { type: string; key: string; payload?: Record<string, unknown>; runAt?: Date }) => {
      if (queued.some((q) => q.key === input.key)) return null;
      queued.push({ type: input.type, key: input.key, payload: input.payload ?? {}, runAt: input.runAt });
      return { id: input.key };
    },
  }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (alerts.push(m), "sent") }));
  vi.doMock("@/lib/google", () => ({ googleModeFor: async () => "dummy" }));
  vi.doMock("@/lib/brief", () => ({ canMessageFreely: async () => windowOpen }));
  vi.doMock("@/lib/onboarding/channel", () => ({ isSandbox: () => sandbox }));
  vi.doMock("@/lib/email", () => ({ sendOwnerEmail: async (_r: unknown, e: { text: string }) => (emails.push(e.text), { delivery: "email" }) }));
  vi.doMock("@/lib/whatsapp", () => ({
    sendDinaChoices: async (_f: string, _t: string, m: { body: string; options: { id: string }[] }) => (sent.push({ kind: `buttons:${m.options.map((o) => o.id).join(",")}`, body: m.body }), { sid: "SM1", body: m.body }),
    sendReviewReadyTemplate: async () => (sent.push({ kind: "template", body: "ready" }), { sid: "SM2", body: "ready" }),
  }));
});
afterEach(() => {
  for (const m of ["@/lib/supabase", "@/lib/queue/store", "@/lib/builder-alerts", "@/lib/google", "@/lib/brief", "@/lib/onboarding/channel", "@/lib/email", "@/lib/whatsapp"]) vi.doUnmock(m);
});

async function load() {
  const parts = await import("@/lib/review/parts");
  // Only these two parts here (each part has its own tests).
  for (const p of ["reviews_sync", "backlog", "themes", "profile", "events"] as const) parts.setRunnerForTests(p, undefined);
  parts.setRunnerForTests("rivals", async () => ({ ours: { rating: 4.3, count: 120 }, nearby: { average: 4.1, n: 5 } }));
  parts.setRunnerForTests("poster", async () => ({ ready: true }));
  const job = await import("@/lib/review/job");
  const fakeJob = (q: (typeof queued)[number]) => ({ id: q.key, type: q.type, payload: q.payload, restaurant_id: R }) as never;
  const run = async (type: string) => {
    for (const q of queued.filter((x) => x.type === type)) await job.REVIEW_HANDLERS[type].run(fakeJob(q));
  };
  return { job, parts, run, fakeJob };
}
const review = () => db.tables.business_reviews.find((x) => x.restaurant_id === R)!;

describe("starting", () => {
  test("once per restaurant: a second start (setup finishing twice, a retry) does nothing", async () => {
    const { job } = await load();
    expect(await job.startBusinessReview(R, "onboarding")).toMatchObject({ started: true });
    expect(await job.startBusinessReview(R, "onboarding")).toEqual({ started: false, reason: "already" });
    expect(db.tables.business_reviews).toHaveLength(1);
    expect(queued.filter((q) => q.type === "business_review")).toHaveLength(1);
  });

  test("a real site isn't reviewed automatically yet; the builder can run it, and run it again", async () => {
    const { job } = await load();
    expect(await job.startBusinessReview(REAL, "onboarding")).toEqual({ started: false, reason: "not_open" });
    expect(await job.startBusinessReview(REAL, "builder")).toMatchObject({ started: true });
    expect(await job.startBusinessReview(REAL, "builder")).toEqual({ started: false, reason: "already" });
    expect(await job.startBusinessReview(REAL, "builder", { force: true })).toMatchObject({ started: true });
    expect(db.tables.business_reviews.filter((x) => x.restaurant_id === REAL)).toHaveLength(1);
    expect(db.tables.audit_log.filter((a) => a.action === "business_review" && a.actor === "builder")).toHaveLength(2);
  });

  test("a problem starting it never stops setup finishing: the builder is told", async () => {
    vi.doMock("@/lib/queue/store", () => ({ enqueue: async () => { throw new Error("job_types row missing"); } }));
    const { job } = await load();
    expect(await job.startAfterOnboarding(R)).toBe(false);
    expect(alerts.join(" ")).toMatch(/058/);
  });
});

describe("running and sending", () => {
  test("parts run side by side; the message goes once when they're all in; the deadline job sends nothing more", async () => {
    const { job, run } = await load();
    await job.startBusinessReview(R, "onboarding");
    await run("business_review");
    expect(queued.filter((q) => q.type === "business_review_part").map((q) => q.payload.part)).toEqual(["rivals", "poster"]);
    const send = queued.find((q) => q.type === "business_review_send")!;
    expect(send.runAt!.getTime() - new Date(review().started_at as string).getTime()).toBe(10 * 60_000);
    await run("business_review_part");
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe(`buttons:review:${review().id}:go`);
    expect(sent[0].body).toContain("⭐ 4.3 from 120 Google reviews. Nearby average: 4.1 across 5 local rivals.");
    expect(sent[0].body).toContain("🪧 Your table QR poster is ready to print.");
    expect(sent[0].body).toContain("Connect Google");
    expect(review()).toMatchObject({ status: "sent", sent_via: "session" });
    // The deadline job, and a retried part, send nothing more.
    await run("business_review_send");
    await run("business_review_part");
    expect(sent).toHaveLength(1);
  });

  test("a failed part drops its section without blocking the message", async () => {
    const { job, run, parts, fakeJob } = await load();
    parts.setRunnerForTests("poster", async () => {
      throw new Error("PDF broke");
    });
    await job.startBusinessReview(R, "onboarding");
    await run("business_review");
    const posterJob = queued.find((q) => q.payload.part === "poster")!;
    await expect(job.REVIEW_HANDLERS.business_review_part.run(fakeJob(posterJob))).rejects.toThrow("PDF broke");
    await job.REVIEW_HANDLERS.business_review_part.onDead!(fakeJob(posterJob), new Error("PDF broke"));
    expect(sent).toHaveLength(0); // rivals still running
    await job.REVIEW_HANDLERS.business_review_part.run(fakeJob(queued.find((q) => q.payload.part === "rivals")!));
    expect(sent).toHaveLength(1);
    expect(sent[0].body).not.toContain("🪧");
    expect(sent[0].body).toContain("⭐");
  });

  test("at the deadline it goes with whatever is ready", async () => {
    const { job, run, fakeJob } = await load();
    await job.startBusinessReview(R, "onboarding");
    await run("business_review");
    await job.REVIEW_HANDLERS.business_review_part.run(fakeJob(queued.find((q) => q.payload.part === "poster")!));
    expect(sent).toHaveLength(0);
    review().deadline_at = new Date(Date.now() - 1000).toISOString();
    await run("business_review_send");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain("🪧");
    expect(sent[0].body).not.toContain("⭐");
  });

  test("nothing ready at all: no message, the builder is told", async () => {
    const { job, run, parts } = await load();
    parts.setRunnerForTests("rivals", undefined);
    parts.setRunnerForTests("poster", async () => ({ ready: false }));
    await job.startBusinessReview(R, "onboarding");
    await run("business_review");
    await run("business_review_part");
    expect(sent).toHaveLength(0);
    expect(review().status).toBe("nothing");
    expect(alerts.join(" ")).toMatch(/found nothing/);
  });
});

describe("WhatsApp's 24-hour window", () => {
  test("no open window, on the sandbox: it waits for the owner's next message and the link is emailed; it goes once", async () => {
    windowOpen = false;
    const { job, run } = await load();
    await job.startBusinessReview(R, "onboarding");
    await run("business_review");
    await run("business_review_part");
    expect(sent).toHaveLength(0);
    expect(review()).toMatchObject({ status: "waiting_window", sent_via: "waiting" });
    expect(emails[0]).toContain("https://app.test/review/ember-spice");
    const { deliverWaitingReview } = await import("@/lib/review/deliver");
    const channel = { restaurantId: R, from: SANDBOX, to: OWNER };
    const r = db.tables.restaurants[0] as never;
    expect(await deliverWaitingReview(r, channel, new Date())).toBe(true);
    expect(await deliverWaitingReview(r, channel, new Date())).toBe(false);
    expect(sent).toHaveLength(1);
    expect(review().status).toBe("sent");
  });

  test("no open window, on a real WhatsApp sender: the approved template", async () => {
    windowOpen = false;
    sandbox = false;
    const { job, run } = await load();
    await job.startBusinessReview(R, "onboarding");
    await run("business_review");
    await run("business_review_part");
    expect(sent.map((s) => s.kind)).toEqual(["template"]);
    expect(review()).toMatchObject({ status: "waiting_window", sent_via: "template" });
    expect(emails).toHaveLength(0);
  });
});

// ---------- Step 2: Dina's wording, checked by code ----------

describe("the message's wording", () => {
  const saved = JSON.parse(readFileSync(new URL("../agents/tests/business-review/01-full-review.json", import.meta.url), "utf8")) as {
    facts: ReviewFacts;
    good: string;
    bad: { why: string; text_replace: [string, string] }[];
  };

  test("the saved case: Dina's good wording passes; each bad one is refused", () => {
    expect(messageProblems(saved.good, saved.facts)).toEqual([]);
    for (const b of saved.bad) {
      const text = saved.good.replace(b.text_replace[0], b.text_replace[1]);
      expect(text, b.why).not.toBe(saved.good);
      expect(messageProblems(text, saved.facts).length, b.why).toBeGreaterThan(0);
    }
  });

  async function writerWith(answers: (string | null)[]) {
    vi.doMock("@/lib/claude", () => ({
      MODELS: { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" },
      MODEL: "claude-sonnet-5-5",
      MAX_TOKENS: 4000,
      WITH_FALLBACK: {},
      fallbackFor: () => ({}),
      claude: () => ({
        beta: {
          messages: {
            parse: async () => {
              const next = answers.shift() ?? null;
              return { stop_reason: "end_turn", content: [], parsed_output: next === null ? null : { message: next }, usage: { input_tokens: 10, output_tokens: 10 }, model: "claude-sonnet-5-5" };
            },
          },
        },
      }),
    }));
    const { writeReviewMessage } = await import("@/lib/review/message");
    return (f: ReviewFacts) => writeReviewMessage(f, { name: "Ember & Spice" } as never);
  }
  beforeEach(() => void delete process.env.AGENTS_LIVE_ALLOWED);
  afterEach(() => vi.doUnmock("@/lib/claude"));

  test("her wording is used when every number matches", async () => {
    const write = await writerWith([saved.good]);
    expect(await write(saved.facts)).toBe(saved.good);
  });

  test("a wrong number twice: code's own message goes instead, and the builder is told", async () => {
    const bad = saved.good.replace("22 reviews are still", "25 reviews are still");
    const write = await writerWith([bad, bad]);
    expect(await write(saved.facts)).toBe(fallbackMessage(saved.facts));
    expect(alerts.join(" ")).toMatch(/business-review/);
  });

  test("a wrong number, then fixed on the retry: the fixed one goes", async () => {
    const bad = saved.good.replace("from 132 Google", "from 133 Google");
    const write = await writerWith([bad, saved.good]);
    expect(await write(saved.facts)).toBe(saved.good);
  });

  test("the kill switch (AGENTS_LIVE_ALLOWED=false): code's own message, no AI", async () => {
    process.env.AGENTS_LIVE_ALLOWED = "false";
    try {
      const write = await writerWith([saved.good]);
      expect(await write(saved.facts)).toBe(fallbackMessage(saved.facts));
    } finally {
      delete process.env.AGENTS_LIVE_ALLOWED;
    }
  });
});
