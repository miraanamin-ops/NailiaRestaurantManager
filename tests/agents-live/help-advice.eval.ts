// Part 5, live: the FAQ, advice and topic cases with real Claude. FAQ: the router,
// the help answer from the real guide, the real fact check (one retry, like the app).
// Advice: the router, then Insights' advice on the Ember & Spice saved data with the
// checker. Topics: the router. Every result is written to .results/part5.json for
// the results table. Run: npm run test:agents -- help-advice
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { Resolved } from "@/lib/agents/tools";
import { addUsage, dollars, totals, type Usage } from "@/lib/agents/usage";
import { caseData, loadInsightsCases } from "../agents/support/insights-cases";
import { EVAL_SETUP, judgeAdvice, judgeFaq, judgeTopic, loadAdvice, loadFaq, loadTopics, type EvalRow } from "../agents/support/help-cases";
import { hasKey } from "./support";

vi.mock("@/lib/builder-alerts", () => ({ alertBuilder: async () => "test run: not sent" }));

const OUT = join("tests", "agents-live", ".results", "part5.json");
const rows: EvalRow[] = [];
const usages: Record<string, Usage[]> = { faq: [], advice: [], topics: [] };
function save() {
  mkdirSync(join("tests", "agents-live", ".results"), { recursive: true });
  let earlier: EvalRow[] = [];
  try {
    earlier = JSON.parse(readFileSync(OUT, "utf8")).rows ?? [];
  } catch {
    // first run
  }
  const sets = new Set(rows.map((r) => r.set));
  const cost = Object.fromEntries(Object.entries(usages).filter(([, u]) => u.length).map(([k, u]) => [k, { per_case: totals(addUsage(...u)).cost / u.length, cases: u.length }]));
  writeFileSync(OUT, `${JSON.stringify({ at: new Date().toISOString(), cost, rows: [...earlier.filter((r) => !sets.has(r.set)), ...rows] }, null, 2)}\n`);
}

const route = async (message: string) => {
  const { runRouter } = await import("@/lib/agents/gm-core");
  return runRouter({ message, recent: [], onScreen: null, open: [], today: "2026-11-09" }, `eval "${message}"`);
};

describe.skipIf(!hasKey)("part 5 (live)", () => {
  test("FAQ: answered from the help guide, checked", async () => {
    const [{ runHelp }, { checkHelpAnswer }, { setupLines }, fs] = await Promise.all([import("@/lib/agents/gm-core"), import("@/lib/agents/gm-help"), import("@/lib/agents/help-rules"), import("node:fs")]);
    const guide = fs.readFileSync(join("agents", "help.md"), "utf8");
    const profile = { version: 1, fields: { name: "MN Test", signup_reward: "A free baklava", discount_cap_percent: 15 } };
    for (const c of loadFaq()) {
      const started = Date.now();
      const routed = await route(c.question);
      const input = { question: c.question, meaning: null, conversation: [], guide, setup: setupLines(EVAL_SETUP), owner: { owner_name: "Miraan", restaurant: "MN Test" } };
      let fix: string[] | null = null;
      let last = null as Awaited<ReturnType<typeof runHelp>>["output"] | null;
      let passed = false;
      let usage = routed.usage;
      const checkerNotes: string[] = [];
      for (let attempt = 1; attempt <= 2 && !passed; attempt++) {
        const answer = await runHelp({ ...input, fix }, `eval faq ${attempt}`);
        usage = addUsage(usage, answer.usage);
        last = answer.output;
        if (!answer.output.covered) break;
        const checked = await checkHelpAnswer(answer.output, input, profile, "eval faq check");
        usage = addUsage(usage, checked.usage);
        passed = checked.pass;
        fix = checked.fails;
        if (!passed) checkerNotes.push(...checked.fails);
      }
      usages.faq.push(usage);
      const problems = judgeFaq(c, routed.output.route, last!, passed);
      if (!passed && checkerNotes.length) problems.push(`checker: ${checkerNotes.join(" | ").slice(0, 300)}`);
      rows.push({ set: "faq", case: c.question, pass: !problems.length, problems, answer: `${last!.message}${last!.action ? ` [button: ${last!.action}]` : ""}`, ms: Date.now() - started });
    }
    save();
    const wrong = rows.filter((r) => r.set === "faq" && !r.pass);
    console.log(`faq: ${rows.filter((r) => r.set === "faq").length - wrong.length} right; ${dollars(totals(addUsage(...usages.faq)).cost / usages.faq.length)} a question`);
    for (const w of wrong) console.log(`  wrong: "${w.case}": ${w.problems.join("; ")} :: ${w.answer}`);
    expect(wrong.map((w) => w.case)).toEqual([]);
  });

  test("advice: 3 ideas from the restaurant's own figures", async () => {
    const [{ insightsLoop }, { adviceText }, { menuProfitFor }, { numbersFrom }, fs] = await Promise.all([
      import("@/lib/agents/insights-core"),
      import("@/lib/agents/insights"),
      import("@/lib/agents/growth"),
      import("@/lib/agents/gm-rules"),
      import("node:fs"),
    ]);
    const base = loadInsightsCases().find((x) => x.file.startsWith("01"))!.case;
    const data = caseData(base);
    const facts = fs.readFileSync(join("agents", "uk-facts.md"), "utf8");
    const menu = (base.profile.fields.menu ?? []) as never;
    const profit = menuProfitFor({ menu, min_margin_pct: 50 } as never, data.sales_items, base.today).menu_profit;
    const extras = [
      profit ? { ref: "menu:profit", title: "Profit by dish (worked out by code from the owner's dish costs)", text: profit, numbers: numbersFrom(profit) } : { ref: "menu:profit", title: "Profit by dish", text: "No dish costs yet, so profit by dish can't be worked out.", numbers: [] },
      { ref: "facts:uk", title: "UK hospitality facts (general, dated)", text: facts, numbers: numbersFrom(facts) },
    ];
    const resolve = async (refs: string[]): Promise<Resolved[]> =>
      refs.map((ref) => {
        const id = ref.slice(ref.indexOf(":") + 1);
        return ref.startsWith("profile:") && id in base.profile.fields ? { ref, found: true, data: base.profile.fields[id] ?? null } : { ref, found: false, reason: "not in this case's data" };
      });
    for (const c of loadAdvice()) {
      const started = Date.now();
      const routed = await route(c.question);
      const outcome = await insightsLoop(
        { task: "advice", question: c.question, profile: base.profile, data, prepared: [], themes: base.themes, today: base.today_words, extras },
        { resolve, checkerProfile: base.profile },
        `eval advice "${c.question}"`,
      ).catch((err: Error) => err);
      if (outcome instanceof Error) {
        // In the app this ends in a relevant suggestion and an unanswered_questions line.
        rows.push({ set: "advice", case: c.question, pass: false, problems: [`invalid output twice: ${outcome.message.slice(0, 200)}`], answer: "", ms: Date.now() - started });
        continue;
      }
      usages.advice.push(addUsage(routed.usage, outcome.usage));
      const text = outcome.kind === "reply" ? adviceText(outcome.output) : outcome.question;
      const problems = judgeAdvice(c, routed.output.route, { kind: outcome.kind, output: outcome.kind === "reply" ? outcome.output : null, checker: outcome.checker?.verdict ?? null, text });
      rows.push({ set: "advice", case: c.question, pass: !problems.length, problems, answer: text, ms: Date.now() - started });
    }
    save();
    const wrong = rows.filter((r) => r.set === "advice" && !r.pass);
    console.log(`advice: ${rows.filter((r) => r.set === "advice").length - wrong.length} right; ${dollars(totals(addUsage(...usages.advice)).cost / usages.advice.length)} a question`);
    for (const w of wrong) console.log(`  wrong: "${w.case}": ${w.problems.join("; ")} :: ${w.answer.slice(0, 300)}`);
    expect(wrong.map((w) => w.case)).toEqual([]);
  });

  test("topics: off topic and borderline", async () => {
    for (const c of loadTopics()) {
      const started = Date.now();
      const routed = await route(c.message);
      usages.topics.push(routed.usage);
      const problems = judgeTopic(c, routed.output.route);
      rows.push({ set: "topics", case: c.message, pass: !problems.length, problems, answer: routed.output.route, ms: Date.now() - started });
    }
    save();
    const wrong = rows.filter((r) => r.set === "topics" && !r.pass);
    for (const w of wrong) console.log(`  wrong: "${w.case}": ${w.problems.join("; ")}`);
    expect(wrong.map((w) => w.case)).toEqual([]);
  });
});
