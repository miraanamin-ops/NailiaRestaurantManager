// The business review end to end, for the three fixture sites (tests/fixtures/
// business-review/sites.ts), with REAL Claude (it costs a little: about $2 to $3
// in all) and everything else standing in: the database is in memory, Twilio
// and email only record what would be sent, Google is dummy. It runs the real
// app code from setup finishing to the evening receipt, the owner tapping
// through the whole guided flow, and writes every WhatsApp message the owner
// would get, in order, to docs/business-review-transcript.md. Run with:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/business-review.e2e.ts
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";
import { IDS, restaurants, SANDBOX, siteAReviews, siteCReviews } from "../fixtures/business-review/sites";

type Line = { site: string; who: "Dina" | "Owner"; text: string; buttons: string[]; media?: string };
const lines: Line[] = [];
let site = "";
const spend = { calls: 0, cost: 0 };
const queued: { type: string; key: string; payload: Record<string, unknown>; runAt?: Date; restaurantId: string | null; done?: boolean }[] = [];
const emails: string[] = [];

const db = memoryDb(
  {
    restaurants: Object.values(restaurants).map((r) => structuredClone(r)),
    reviews: [...siteAReviews(), ...siteCReviews()],
    customers: [],
    messages: [{ id: "in-a", restaurant_id: IDS.A, direction: "inbound", from_number: restaurants.A.owner_whatsapp, to_number: SANDBOX, body: "That's everything", created_at: new Date(Date.now() - 60_000).toISOString() },
      { id: "in-c", restaurant_id: IDS.C, direction: "inbound", from_number: restaurants.C.owner_whatsapp, to_number: SANDBOX, body: "Done!", created_at: new Date(Date.now() - 60_000).toISOString() }],
    drafts: [], audit_log: [], business_reviews: [], business_review_parts: [], review_tags: [], rival_places: [], calendar_events: [], time_saved_log: [],
    sent_log: [], blocked_sends: [], google_writes: [], google_posts: [], campaigns: [], rate_limits: [], agent_jobs: [], draft_feedback: [], profile_versions: [],
  },
  { unique: ["business_reviews.restaurant_id", "sent_log.draft_id", "google_writes.key"] },
);

beforeAll(async () => {
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.dinerai.co.uk" }));
  vi.doMock("@/lib/queue/store", () => ({
    enqueue: async (i: { type: string; key: string; payload?: Record<string, unknown>; runAt?: Date; restaurantId: string | null }) => {
      if (queued.some((q) => q.key === i.key)) return null;
      queued.push({ ...i, payload: i.payload ?? {} });
      return { id: i.key };
    },
  }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (console.log(`[builder alert] ${m}`), "ok") }));
  vi.doMock("@/lib/email", async (orig) => ({ ...(await orig<object>()), sendOwnerEmail: async (_r: unknown, e: { subject: string; text: string }) => (emails.push(`${e.subject}\n${e.text}`), { delivery: "email" }), sendBuilderEmail: async () => ({}) }));
  vi.doMock("@/lib/onboarding/channel", async (orig) => ({ ...(await orig<object>()), isSandbox: () => true }));
  const say = (text: string, buttons: string[] = [], media?: string) => lines.push({ site, who: "Dina", text, buttons, ...(media ? { media } : {}) });
  vi.doMock("@/lib/whatsapp", async (orig) => ({
    ...(await orig<object>()),
    sendText: async (_f: string, _t: string, body: string) => (say(body), { sid: "SM", body }),
    sendImage: async (_f: string, _t: string, url: string, caption = "") => (say(caption, [], url), { sid: "SM", body: caption }),
    sendDinaChoices: async (_f: string, _t: string, m: { body: string; options: { title: string }[] }) => (say(m.body, m.options.map((o) => o.title)), { sid: "SM", body: m.body, usedButtons: true }),
    sendWithApprovalButtons: async (_f: string, _t: string, body: string, target?: { buttons?: string }) => (say(body, target?.buttons === "question" ? ["Reply publicly", "Handle privately", "Both"] : ["Approve", "Edit", "Skip"]), { sid: "SM", body, usedButtons: true }),
    sendReviewReadyTemplate: async () => (say("[template] Your DinerAI business review is ready", ["See my review"]), { sid: "SM", body: "template" }),
  }));
  // Count what Claude costs.
  vi.doMock("@/lib/claude", async (orig) => {
    const real = await orig<typeof import("@/lib/claude")>();
    const { tokensFrom } = await import("@/lib/agents/usage");
    const wrap = <T extends (...a: never[]) => Promise<{ usage?: unknown; model?: string }>>(fn: T) =>
      (async (...args: Parameters<T>) => {
        const res = await fn(...args);
        spend.calls++;
        spend.cost += tokensFrom(res.model ?? "", res.usage as never).cost;
        return res;
      }) as T;
    return {
      ...real,
      claude: () => {
        const c = real.claude();
        return { ...c, beta: { ...c.beta, messages: { ...c.beta.messages, parse: wrap(c.beta.messages.parse.bind(c.beta.messages)), create: wrap(c.beta.messages.create.bind(c.beta.messages) as never) } } } as typeof c;
      },
    };
  });
}, 120_000);

afterAll(() => {
  const out = ["# Business review: what each owner would get on WhatsApp", "", `Real run, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Claude: ${spend.calls} calls, about $${spend.cost.toFixed(2)}. Database, Twilio and email were stand-ins; Google was dummy.`, ""];
  let last = "";
  for (const l of lines) {
    if (l.site !== last) out.push("", `## ${l.site}`, "");
    last = l.site;
    const body = l.text ? l.text.split("\n").map((x) => `> ${x}`).join("\n") : "";
    out.push(`**${l.who}**${l.media ? ` (attachment: ${l.media})` : ""}`, "", body, ...(l.buttons.length ? ["", `Buttons: ${l.buttons.map((b) => `[${b}]`).join(" ")}`] : []), "");
  }
  if (emails.length) out.push("", "## Emails to owners", "", ...emails.map((e) => e.split("\n").map((x) => `> ${x}`).join("\n") + "\n"));
  writeFileSync(new URL("../../docs/business-review-transcript.md", import.meta.url), out.join("\n"));
  console.log(`Claude: ${spend.calls} calls, about $${spend.cost.toFixed(2)}`);
});

// Runs every job that's due (and, with all, the ones for later too, like the receipt).
async function worker(opts: { all?: boolean } = {}) {
  const { REVIEW_HANDLERS } = await import("@/lib/review/job");
  for (let pass = 0; pass < 200; pass++) {
    const job = queued.find((q) => !q.done && REVIEW_HANDLERS[q.type] && (opts.all || !q.runAt || q.runAt.getTime() <= Date.now() + 1000 || q.type === "review_reply_release" || q.type === "business_review_send"));
    if (!job) return;
    job.done = true;
    const handler = REVIEW_HANDLERS[job.type];
    const fake = { id: job.key, type: job.type, payload: job.payload, restaurant_id: job.restaurantId } as never;
    try {
      await handler.run(fake);
    } catch (err) {
      console.error(`job ${job.key} failed`, err);
      await handler.onDead?.(fake, err);
    }
  }
}

// What the owner tapped, as they saw it: the button's title on Dina's last message with buttons.
function tapLabel(tap: string) {
  const action = tap.split(":").slice(tap.startsWith("review:") ? 2 : 0).join(":");
  const names: Record<string, string> = { go: "Let's go", next: "Next", stop: "Stop for now", "replies:all": "Approve all", "replies:one": "One by one", "profile:approve": "Approve fixes", "themes:ok": "Got it", "audiences:done": "That's all", "audiences:none": "None of these", "campaigns:go": "Go through them", "campaigns:skip": "Skip" };
  if (names[action]) return `"${names[action]}"`;
  if (action.startsWith("audiences:add-")) return `"${action.slice(14)}"`;
  if (action.startsWith("approve:")) return "\"Approve\"";
  if (action.startsWith("both:")) return "\"Both\"";
  return action;
}

async function owner(id: string, body: string, tap?: string) {
  const r = db.tables.restaurants.find((x) => x.id === id)!;
  lines.push({ site, who: "Owner", text: tap ? `(taps ${tapLabel(tap)})` : body, buttons: [] });
  db.tables.messages.push({ id: `in-${Date.now()}-${Math.random()}`, restaurant_id: id, direction: "inbound", from_number: r.owner_whatsapp, to_number: SANDBOX, body, created_at: new Date().toISOString() });
  const { handleMessage } = await import("@/lib/bot");
  await handleMessage({ restaurantId: id, owner: String(r.owner_whatsapp), sandbox: SANDBOX, body, buttonPayload: tap });
  await worker();
}

const reviewId = (id: string) => String(db.tables.business_reviews.find((x) => x.restaurant_id === id)!.id);
const tapFlow = (id: string, action: string) => owner(id, "", `review:${reviewId(id)}:${action}`);

async function approveOneByOne(id: string, max = 30) {
  for (let i = 0; i < max; i++) {
    const shown = [...lines].reverse().find((l) => l.who === "Dina" && /^\*\d+ of \d+\*/.test(l.text));
    const pending = db.tables.drafts.filter((d) => d.restaurant_id === id && d.status === "pending" && String(shown?.text ?? "").includes(String(d.content).slice(0, 40)));
    if (!shown || !pending.length || lines.at(-1)!.text.startsWith("Next?") || lines.at(-1)!.text.startsWith("That's everything")) return;
    const d = pending[0];
    if (d.kind === "review_question") await owner(id, "", `both:${d.id}`);
    else await owner(id, "", `approve:${d.id}`);
  }
}

test("Site A: connected, gaps, 60 reviews, nobody on the list", async () => {
  site = "Site A: Saffron Coal Grill (Google connected, gaps, 60 reviews, 22 unanswered)";
  const { startBusinessReview } = await import("@/lib/review/job");
  expect(await startBusinessReview(IDS.A, "onboarding")).toMatchObject({ started: true });
  await worker();
  const review = db.tables.business_reviews.find((x) => x.restaurant_id === IDS.A)!;
  expect(review.status).toBe("sent");
  await tapFlow(IDS.A, "go");
  await tapFlow(IDS.A, "replies:all");
  await tapFlow(IDS.A, "next");
  await approveOneByOne(IDS.A);
  if (lines.at(-1)!.text.startsWith("Next?")) await tapFlow(IDS.A, "next");
  await tapFlow(IDS.A, "profile:approve");
  if (lines.at(-1)!.text.startsWith("Next?")) await tapFlow(IDS.A, "next");
  await tapFlow(IDS.A, "themes:ok");
  if (lines.at(-1)!.text.startsWith("Next?")) await tapFlow(IDS.A, "next");
  await tapFlow(IDS.A, "audiences:add-muslim");
  await tapFlow(IDS.A, "audiences:done");
  if (lines.at(-1)!.text.startsWith("Next?")) await tapFlow(IDS.A, "next");
  await tapFlow(IDS.A, "campaigns:go");
  await approveOneByOne(IDS.A);
  if (lines.at(-1)!.text.startsWith("Next?")) await tapFlow(IDS.A, "next");
  // The evening receipt.
  await worker({ all: true });
  expect(lines.some((l) => l.site === site && l.text.startsWith("🧾"))).toBe(true);
}, 30 * 60_000);

test("Site B: Google not connected; the owner hasn't messaged in 24 hours", async () => {
  site = "Site B: Mango Tree Cafe (Google not connected, no message in 24 hours)";
  const { startBusinessReview } = await import("@/lib/review/job");
  expect(await startBusinessReview(IDS.B, "onboarding")).toMatchObject({ started: true });
  await worker();
  expect(db.tables.business_reviews.find((x) => x.restaurant_id === IDS.B)!.status).toBe("waiting_window");
  await owner(IDS.B, "Hi Dina");
  await tapFlow(IDS.B, "go");
  for (let i = 0; i < 8 && !lines.at(-1)!.text.startsWith("That's everything"); i++) {
    const last = lines.at(-1)!;
    if (last.text.startsWith("Next?")) await tapFlow(IDS.B, "next");
    else if (last.text.includes("Which dates should I plan for")) await tapFlow(IDS.B, "audiences:none");
    else if (last.buttons.includes("Go through them")) await tapFlow(IDS.B, "campaigns:go");
    else if (last.buttons.includes("Approve")) await approveOneByOne(IDS.B);
    else break;
  }
  await worker({ all: true });
}, 30 * 60_000);

test("Site C: 4 reviews, all answered; a complete profile; no rivals", async () => {
  site = "Site C: Little Lantern Bakery (4 reviews, all answered, complete profile, no rivals)";
  const { startBusinessReview } = await import("@/lib/review/job");
  expect(await startBusinessReview(IDS.C, "onboarding")).toMatchObject({ started: true });
  await worker();
  const sent = lines.filter((l) => l.site === site && l.who === "Dina");
  expect(sent[0].text).toContain("You've replied to every review");
  expect(sent[0].text).not.toContain("👍");
  await tapFlow(IDS.C, "go");
  for (let i = 0; i < 8 && !lines.at(-1)!.text.startsWith("That's everything"); i++) {
    const last = lines.at(-1)!;
    if (last.text.startsWith("Next?")) await tapFlow(IDS.C, "next");
    else if (last.text.includes("Which dates should I plan for")) await tapFlow(IDS.C, "audiences:none");
    else if (last.buttons.includes("Go through them")) await tapFlow(IDS.C, "campaigns:skip");
    else break;
  }
  await worker({ all: true });
}, 30 * 60_000);
