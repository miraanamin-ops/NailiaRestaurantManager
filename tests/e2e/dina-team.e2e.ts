// Step 8 (team and labour) with the REAL Claude, on the in-memory database (no
// Supabase; nothing is sent). The owner arrives on the team step and sends the
// Pilot Zero staff sheet (pilot-zero/staff-sheet.csv), then answers what Dina asks
// (site manager, cover rules, labour target) until she shows the team card; taps
// "Looks right"; code saves the team with everyone's availability. Prints the
// conversation, the card and the cost. About $0.20 to $0.50. Run on its own:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/dina-team.e2e.ts
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { memoryDb } from "../support/memory-db";

const R = "eeeeeeee-0000-4000-8000-0000000000f8";
let db: ReturnType<typeof memoryDb>;
let n = 0;
let cost = 0;
const stumbles: string[] = [];

beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Needs ANTHROPIC_API_KEY (run with --env-file=.env.local)");
  db = memoryDb(
    {
      restaurants: [{ id: R, name: "Pilot Zero Food Hall", slug: "pilot-zero-e2e", owner_name: "Miraan", owner_email: "me@example.org", is_demo: true, active: false, address: "Ilford Lane, Ilford IG1", cuisine: "Halal food hall", menu: [], profile_version: 0, labour_target_pct: null, discount_cap_percent: 20, signup_reward: null, brief_hour: 9 }],
      onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "team", channel_last_used: "web", started_at: new Date().toISOString(), completed_at: null }],
      onboarding_steps: ["hello", "google", "tone", "make_it_right", "menu", "hours_faqs", "sales"].map((k) => ({ restaurant_id: R, step_key: k, status: "done", data: {}, completed_at: new Date().toISOString() })),
      onboarding_messages: [],
      setup_gaps: [],
      onboarding_ai_usage: [],
      audit_log: [],
      profile_versions: [],
      staff: [],
      rota_rules: [],
      messages: [],
    },
    { unique: ["onboarding_messages.external_id"] },
  );
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client, appUrl: () => "https://app.dinerai.co.uk" }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (_k: string, m: string) => (console.warn("ALERT", m), "sent") }));
  vi.doMock("@/lib/ops/menu", async (orig) => ({
    ...(await orig<object>()),
    updateRestaurantColumns: async (id: string, fields: Record<string, unknown>) => void Object.assign(db.tables.restaurants.find((r) => r.id === id)!, fields),
  }));
  vi.doMock("@/lib/email", () => ({ sendOwnerEmail: async () => ({ delivery: "email", id: "e", to: "me@example.org", redirectedFrom: null }) }));
});

type Out = { messages: { id: string; text: string; component: unknown }[]; step: string | null; costUsd: number; fallback: boolean; toolCalls: { name: string; ok?: boolean; output?: unknown }[]; reply: unknown };

async function turn(input: { text: string | null; note?: string | null; data?: unknown[]; ownerParts?: unknown[]; event?: "message" | "resume" }) {
  const { dinaTurn } = await import("@/lib/onboarding/dina/turn");
  const { dinaReplyProblems } = await import("@/lib/onboarding/dina/reply");
  const out = (await dinaTurn({ restaurantId: R, channel: "web", event: input.event ?? "message", text: input.text, externalId: `team-e2e-${++n}`, note: input.note ?? null, data: input.data as never, ownerParts: input.ownerParts })) as unknown as Out & { duplicate: boolean };
  if (out.duplicate) throw new Error("duplicate");
  cost += out.costUsd;
  console.log(`\n--- ${input.text ? `owner: "${input.text.slice(0, 120)}"` : "owner arrives"}${input.note ? `  [code: ${input.note.slice(0, 100)}…]` : ""}  ($${out.costUsd.toFixed(4)})`);
  for (const t of out.toolCalls ?? []) console.log(`   tool ${t.name}: ${JSON.stringify(t.output ?? "").slice(0, 300)}`);
  for (const m of out.messages) console.log(`Dina: ${m.text}${m.component ? `  [${JSON.stringify(m.component)}]` : ""}`);
  if (out.fallback) stumbles.push(`turn ${n}: Dina's reply failed the coded checks, so the owner got code's fallback line`);
  const problems = dinaReplyProblems(out.reply as never);
  if (problems.length) stumbles.push(`turn ${n}: ${problems.join("; ")}`);
  const questions = out.messages.filter((m) => m.text.includes("?")).length;
  if (questions > 1) stumbles.push(`turn ${n}: ${questions} messages with a question in one turn`);
  return out;
}

const hasCard = (out: Out) => out.messages.some((m) => (m.component as { type?: string; card?: string } | null)?.type === "editable_card" && (m.component as { card?: string }).card === "team");

// The owner's answer to whatever Dina just asked (the team step's questions).
function answerFor(out: Out) {
  const asked = out.messages.map((m) => m.text).join(" ").toLowerCase();
  if (/labour|target|% of sales|percent/.test(asked)) return "28%";
  if (/cover|on (each|every|a) shift|minimum|at least|how many/.test(asked)) return "At least 1 manager, 2 in the kitchen and 2 front of house on every shift.";
  if (/manager|runs the site|day to day|in charge/.test(asked)) return "Yusuf Rahman runs the site day to day.";
  if (/look right|correct|check/.test(asked)) return "Yes that all looks right.";
  return "Yes, that's right.";
}

describe("step 8 with the staff sheet, for real", () => {
  test("the sheet, Dina's questions, the team card, Looks right: saved with availability", async () => {
    await turn({ text: null, event: "resume" });

    // The owner sends the staff sheet in the chat (as the web chat's "files" action does).
    const path = `${R}/incoming/staff-sheet.csv`;
    await db.client.storage.from("onboarding-uploads").upload(path, readFileSync("pilot-zero/staff-sheet.csv"), { contentType: "text/csv" });
    const file = { type: "file" as const, path, kind: "csv" as const, contentType: "text/csv", bytes: 940 };
    const { dataForFiles, noteForFiles } = await import("@/lib/onboarding/dina/whatsapp-turn");
    let out = await turn({ text: "📎 staff-sheet.csv", note: await noteForFiles(R, "team", [file], "in the chat"), data: await dataForFiles(R, "team", [file]), ownerParts: [file] });

    for (let i = 0; i < 6 && !hasCard(out); i++) out = await turn({ text: answerFor(out) });
    if (!hasCard(out)) stumbles.push("Dina never showed the team card within 6 answers");
    expect(hasCard(out)).toBe(true);

    // The card, from the draft code holds.
    const { cardFor } = await import("@/lib/onboarding/dina/view");
    const { loadFlow } = await import("@/lib/onboarding/sessions");
    const card = cardFor("team", { restaurant: db.tables.restaurants[0] as never, state: (await loadFlow(R)).state });
    console.log(`\n=== The team card ===\n${card?.fields.map((f) => `${f.label}: ${f.value ?? "(none)"}`).join("\n")}`);

    // "Looks right".
    const cardMessage = out.messages.find((m) => (m.component as { type?: string } | null)?.type === "editable_card")!;
    const { handleAnswer } = await import("@/lib/onboarding/dina/answers");
    const note = await handleAnswer({ restaurantId: R, messageId: cardMessage.id, choiceId: "confirm", channel: "web" });
    console.log(`\n[code: ${String(note)}]`);
    await turn({ text: "Looks right", note: typeof note === "string" ? note : null, ownerParts: [{ type: "answer", to: cardMessage.id, choice: "confirm" }] });

    // What was saved, against the sheet as the rota's parser reads it.
    const { availabilityOf } = await import("@/lib/onboarding/dina/ops-content");
    const sheet = readFileSync("pilot-zero/staff-sheet.csv", "utf8").trim().split("\r\n").slice(1).map((l) => l.slice(1, -1).split('","'));
    const staff = db.tables.staff as Record<string, unknown>[];
    console.log(`\n=== Saved: ${staff.length} staff ===`);
    for (const [name, , rate, hours, days, times, max] of sheet) {
      const row = staff.find((s) => String(s.display_name).toLowerCase() === name.toLowerCase());
      if (!row) {
        stumbles.push(`${name} wasn't saved`);
        continue;
      }
      const want = availabilityOf({ days, times, max_hours: Number(max) });
      const spans = ((db.tables.staff_availability ?? []) as Record<string, unknown>[]).filter((a) => a.staff_id === row.id);
      const gotDays = [...new Set(spans.map((a) => Number(a.weekday)))].sort();
      const wantDays = want.days ?? [1, 2, 3, 4, 5, 6, 7];
      const gotTimes = spans[0] ? `${String(spans[0].starts)}-${String(spans[0].ends)}` : "none";
      const wantTimes = `${want.starts ?? "00:00"}-${want.ends ?? "23:59"}`;
      const pay = ((db.tables.staff_pay_rates ?? []) as Record<string, unknown>[]).find((p) => p.staff_id === row.id)?.hourly_pence;
      console.log(`${name}: days ${gotDays.join(",")} · ${gotTimes} · max ${String(row.max_hours_week)}h · ${String(row.contracted_hours)}h contracted · ${String(pay)}p`);
      if (Number(row.contracted_hours ?? NaN) !== Number(hours)) stumbles.push(`${name}: contracted hours ${String(row.contracted_hours)} (sheet ${hours})`);
      if (Number(row.max_hours_week ?? NaN) !== want.maxHours) stumbles.push(`${name}: max hours ${String(row.max_hours_week)} (sheet ${max})`);
      if (gotDays.join(",") !== wantDays.join(",")) stumbles.push(`${name}: days ${gotDays.join(",")} (sheet "${days}")`);
      if (gotTimes !== wantTimes) stumbles.push(`${name}: times ${gotTimes} (sheet "${times}")`);
      if (Number(pay) !== Math.round(Number(rate.replace("£", "")) * 100)) stumbles.push(`${name}: pay ${String(pay)}p (sheet ${rate})`);
    }
    const team = db.tables.onboarding_steps.find((s) => s.step_key === "team");
    console.log(`\nTeam step: ${JSON.stringify(team?.status)} ${JSON.stringify((team?.data as Record<string, unknown>)?.with_availability)} with availability; rules ${JSON.stringify(db.tables.rota_rules)}; target ${String(db.tables.restaurants[0].labour_target_pct)}`);
    console.log(`\n=== Cost: $${cost.toFixed(3)} ===\n=== Stumbles (${stumbles.length}) ===\n${stumbles.join("\n") || "none"}`);
    expect(team?.status).toBe("done");
  });
});
