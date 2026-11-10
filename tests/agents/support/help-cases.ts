// Part 5's real-Claude cases (agents/tests/gm/faq.json, advice.json, topics.json):
// loaders and the judges, plain code so they're unit-tested too.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Route } from "@/lib/agents/gm-rules";
import type { HelpOutputType, SetupFacts } from "@/lib/agents/help-rules";
import type { InsightsOutput } from "@/lib/agents/insights-rules";

const DIR = join("agents", "tests", "gm");
const load = <T>(name: string): T => JSON.parse(readFileSync(join(DIR, name), "utf8"));

export type FaqCase = { question: string; routes: Route[]; covered: boolean; mention_all: string[][]; not_yet_any?: string[]; action?: boolean; must_not_contain: string[]; note?: string };
export type AdviceCase = { question: string; cites_figure: boolean; mention_any?: string[]; routes?: Route[]; note?: string };
export type TopicCase = { message: string; routes: Route[]; note?: string };

export const loadFaq = () => load<{ cases: FaqCase[] }>("faq.json").cases;
export const loadAdvice = () => load<{ cases: AdviceCase[] }>("advice.json").cases;
export const loadTopics = () => load<{ cases: TopicCase[] }>("topics.json").cases;

// The setup the FAQ answers use (a restaurant part-way set up).
export const EVAL_SETUP: SetupFacts = {
  google_connected: false,
  customers: 15,
  emailable_customers: 15,
  signup_page: "https://app.dinerai.co.uk/r/mn-test",
  qr_card: "https://app.dinerai.co.uk/r/mn-test/qr",
  qr_pack: "https://app.dinerai.co.uk/r/mn-test/qr-pack",
  signup_reward: "A free baklava",
  discount_cap_percent: 15,
  send_window: "09:00 to 21:00",
  paused: false,
  sales_days_last_30: 6,
  item_sales_last_30: false,
  dishes: 24,
  dishes_with_costs: 0,
  allergens_to_confirm: 3,
  staff_phones: 0,
  today: "2026-11-09",
};

const has = (text: string, word: string) => text.toLowerCase().includes(word.toLowerCase());

export function judgeFaq(c: FaqCase, route: Route, out: HelpOutputType, checkerPassed: boolean) {
  const problems: string[] = [];
  if (!c.routes.includes(route)) problems.push(`routed to ${route}, expected ${c.routes.join(" or ")}`);
  if (out.covered !== c.covered) problems.push(c.covered ? "said the guide doesn't cover it" : "answered something the guide doesn't cover");
  if (c.covered && !checkerPassed) problems.push("the fact check didn't pass it (after one retry)");
  for (const group of c.mention_all) if (!group.some((w) => has(out.message, w))) problems.push(`should mention one of: ${group.join(", ")}`);
  if (c.not_yet_any && !c.not_yet_any.some((w) => has(out.message, w))) problems.push(`should say plainly it isn't possible (one of: ${c.not_yet_any.join(", ")})`);
  if (c.action && !out.action) problems.push("should offer to do it (action)");
  for (const w of c.must_not_contain) if (new RegExp(`\\b${w}\\b`).test(out.message)) problems.push(`must not contain "${w}"`);
  return problems;
}

export function judgeAdvice(c: AdviceCase, route: Route, outcome: { kind: "reply" | "question"; output: InsightsOutput | null; checker: string | null; text: string }) {
  const problems: string[] = [];
  const routes = c.routes ?? ["advice"];
  if (!routes.includes(route)) problems.push(`routed to ${route}, expected ${routes.join(" or ")}`);
  if (outcome.kind !== "reply" || !outcome.output) return [...problems, `no ideas: ${outcome.text.slice(0, 160)}`];
  const out = outcome.output;
  if (outcome.checker !== "pass") problems.push(`the checker said ${outcome.checker}`);
  if (out.type !== "advice") problems.push(`type ${out.type}`);
  if (out.content.actions.length !== 3) problems.push(`${out.content.actions.length} ideas, not 3`);
  if (out.content.actions.some((a) => !a.message.trim())) problems.push("an idea has no next step");
  const tied = out.content.actions.filter((a) => /\d/.test(a.why) && !/^general\b/i.test(a.why.trim()));
  if (c.cites_figure && !tied.length) problems.push("no idea is tied to the restaurant's own figures");
  if (c.mention_any && !c.mention_any.some((w) => has(outcome.text, w))) problems.push(`should mention one of: ${c.mention_any.join(", ")}`);
  return problems;
}

export function judgeTopic(c: TopicCase, route: Route) {
  return c.routes.includes(route) ? [] : [`routed to ${route}, expected ${c.routes.join(" or ")}`];
}

export type EvalRow = { set: "faq" | "advice" | "topics" | "conversations" | "routing"; case: string; pass: boolean; problems: string[]; answer: string; ms: number };
