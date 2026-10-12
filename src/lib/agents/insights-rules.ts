// The Insights agent's output and the plain-code rules every answer must pass
// (on top of the shared draft rules): every figure traces to a query_metrics
// result, every number in the words is one of those figures, no cause stated as
// fact, small samples and odd-looking till figures flagged, information not advice.
// Zod and pure code only, so it's unit-tested (tests/agents/insights.test.ts).
import { z } from "zod";
import { numbersIn, type Figure, type MetricResult } from "./insights-metrics";
import { draftProblems, type Problems } from "./schema";

export const INSIGHTS_TYPES = ["answer", "report_section"] as const;
export type InsightsTask = "answer" | "report";

// insights.md "Output", with the actions as objects (the Monday report's 3 actions:
// what, why, and the WhatsApp message that starts it) and each figure naming the
// query it came from.
export const InsightsDraft = z.object({
  type: z.enum(INSIGHTS_TYPES),
  channel: z.literal("owner"),
  content: z.object({
    headline: z.string().describe("Report: the one-sentence headline. Answer: empty"),
    body: z.string().describe("Answer: the reply, 1 to 3 sentences. Report: the sales section, a few sentences"),
    actions: z
      .array(
        z.object({
          title: z.string().describe("Under 8 words"),
          why: z.string().describe("One sentence tied to a number in the report"),
          message: z.string().describe("What the owner sends on WhatsApp to start it"),
        }),
      )
      .describe("Report: exactly 3. Answer: none"),
  }),
  figures: z.array(
    z.object({
      metric: z.string(),
      value: z.number(),
      unit: z.enum(["GBP", "count", "percent", "stars", "celsius", "mm"]),
      period: z.string(),
      compare_to: z.string().nullable(),
      compare_value: z.number().nullable(),
      source: z.string().describe("metrics:<query id> the figure came from"),
    }),
  ),
  confidence: z.enum(["high", "low"]),
  needs_owner_input: z.string().nullable(),
  sources_used: z.array(z.string()),
});
export type InsightsOutput = z.infer<typeof InsightsDraft>;

const EM_DASH = new RegExp(String.fromCharCode(0x2014));
const JARGON = /\b(AOV|KPIs?|YoY|WoW|MoM|ATV|ARPU)\b/;
// Stating a cause as fact (insights.md: "coincided with", "likely helped").
const CAUSE = /\b(caused|causing|led to|drove|driven by|resulted in|boosted|because of (?:the|your) (?:offer|campaign|deal|email|post)|thanks to (?:the|your) (?:offer|campaign|deal|email|post)|(?:offer|campaign|deal|email) (?:increased|added|brought in|generated))\b/i;
// Advice on loans, tax, pay, hiring or firing (information only; decisions are the owner's).
const ADVICE = /\b(?:you should|you could|I(?:'d| would)? (?:recommend|suggest|advise)|consider|it(?:'s| is) worth|best to|makes sense to)\b[^.!?]*\b(?:cut|hire|fire|let (?:\w+ )?go|lay off|redundan\w*|reduce (?:staff|hours|shifts)|fewer staff|staff(?:ing)?|rota|shifts?|wages?|pay ?rise|loan|borrow|tax|VAT return)\b/i;
const SMALL_WORDS = /\b(only|early|small|few|fewer than|under (?:4|four) weeks|under 20|not enough|too little|limited|short)\b/i;
const ASK_WORDS = /\b(check|confirm|right|correct|typo|mistake|misread|unusual)\b/i;

const sentences = (text: string) =>
  text
    .replace(/(\d)\.(\d)/g, "$1,$2")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// ---------- Numbers in the words ----------

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const DAYS = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun";
const UNITS = "days?|weeks?|months?|years?|nights?|hours?|Mondays|Tuesdays|Wednesdays|Thursdays|Fridays|Saturdays|Sundays|actions?|sentences?";

export type QuotedNumber = { text: string; value: number; kind: "money" | "percent" | "number" };

// The numbers a reader would take as figures: money, percentages and counts.
// Dates, times, years and small period words ("4 weeks", "the 4 Saturdays before") aren't figures.
export function quotedNumbers(text: string): QuotedNumber[] {
  const cleaned = text
    .replace(new RegExp(`\\b(?:${DAYS}),?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s+(?:${MONTHS}))?(?:\\s+\\d{4})?\\b`, "gi"), " ")
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})(?:\\s+\\d{4})?\\b`, "gi"), " ")
    .replace(new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"), " ")
    .replace(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(new RegExp(`\\b(?:[1-9]|1[0-2])\\s+(?:${UNITS})\\b`, "gi"), " ")
    .replace(/\b(?:[1-9]|1[0-2])-(?:day|week|month|year)\b/gi, " ")
    .replace(new RegExp(`\\b(?:last|past|previous|next|the)\\s+(?:[1-9]|1[0-2])\\b`, "gi"), " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, " ");
  const out: QuotedNumber[] = [];
  for (const m of cleaned.matchAll(/(£)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(%|per ?cent)|(\d[\d,]*(?:\.\d+)?)/gi)) {
    const raw = (m[2] ?? m[3] ?? m[5]).replace(/,/g, "");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ text: m[0].trim(), value, kind: m[1] ? "money" : m[4] ? "percent" : "number" });
  }
  return out;
}

// A figure as written, rounded for reading or not: £8,420 for 8419.62, 12% for 11.87.
function sameNumber(written: number, exact: number) {
  return Math.abs(written - exact) < 0.005 || written === Math.round(exact) || Math.abs(written - Math.round(exact * 10) / 10) < 0.0001;
}

function matchesFigure(q: QuotedNumber, figures: { value: number; unit: Figure["unit"] }[]) {
  return figures.some((f) => {
    if (q.kind === "money") return f.unit === "GBP" && sameNumber(q.value, f.value);
    if (q.kind === "percent") return f.unit === "percent" && sameNumber(q.value, Math.abs(f.value));
    return f.unit !== "percent" && sameNumber(q.value, Math.abs(f.value));
  });
}

// ---------- The rules ----------

export type InsightsContext = {
  task: InsightsTask;
  // Every query_metrics result this job has seen, by id (q1, q2...).
  results: Map<string, MetricResult>;
};

const metricsId = (ref: string) => (ref.startsWith("metrics:") ? ref.slice("metrics:".length).trim() : null);

export function insightsProblems(out: InsightsOutput, ctx: InsightsContext): Problems {
  const problems = draftProblems(out);
  const want = ctx.task === "report" ? "report_section" : "answer";
  if (out.type !== want) problems.push(`this is ${ctx.task === "report" ? "the Monday report" : "an answer to the owner"}: type ${want}`);

  const allNumbers = [...ctx.results.values()].flatMap(numbersIn);
  const texts = [out.content.headline, out.content.body, ...out.content.actions.flatMap((a) => [a.title, a.why, a.message]), out.needs_owner_input ?? ""];
  const allText = texts.join("\n");
  if (EM_DASH.test(allText)) problems.push("no em-dashes");
  if (JARGON.test(allText)) problems.push(`no jargon ("${allText.match(JARGON)![0]}"): say it in plain words`);

  // Sources: every metrics reference is a query this job really ran.
  for (const ref of out.sources_used) {
    const id = metricsId(ref);
    if (id && !ctx.results.has(id)) problems.push(`${ref} isn't a query_metrics result from this job`);
  }
  const used = out.sources_used.map(metricsId).filter((id): id is string => Boolean(id && ctx.results.has(id))).map((id) => ctx.results.get(id)!);

  // A question for the owner: any figures in it are real ones.
  if (out.needs_owner_input) {
    for (const q of quotedNumbers(out.needs_owner_input)) {
      if (!matchesFigure(q, allNumbers)) problems.push(`"${q.text}" in the question isn't a figure from query_metrics`);
    }
    return problems;
  }

  // Figures: each one is a number its query returned (never worked out by the agent).
  for (const f of out.figures) {
    const id = metricsId(f.source);
    const result = id ? ctx.results.get(id) : undefined;
    if (!result) {
      problems.push(`figure ${f.metric} (${f.value}): source must be metrics:<id> of a query this job ran`);
      continue;
    }
    if (!out.sources_used.includes(f.source)) problems.push(`figure ${f.metric}: add ${f.source} to sources_used`);
    const numbers = numbersIn(result);
    // A change can be given without its sign ("down 2%" for -2).
    const exists = (v: number, unit: string) =>
      numbers.some((n) => (unit === n.unit || (unit === "count" && n.unit !== "GBP")) && (sameNumber(v, n.value) || (unit === "percent" && sameNumber(Math.abs(v), Math.abs(n.value)))));
    if (!exists(f.value, f.unit)) problems.push(`figure ${f.metric} = ${f.value} isn't in ${f.source}: never work a figure out yourself; ask query_metrics for it`);
    if (f.compare_value !== null && !exists(f.compare_value, f.unit)) problems.push(`figure ${f.metric}'s compare_value ${f.compare_value} isn't in ${f.source}`);
    if (f.unit === "percent" && !f.compare_to) problems.push(`figure ${f.metric} is a percentage: say what it's compared against (compare_to)`);
  }

  // Every number in the words is one of the figures.
  const figureNumbers = out.figures.flatMap((f) => [{ value: f.value, unit: f.unit }, ...(f.compare_value !== null ? [{ value: f.compare_value, unit: f.unit }] : [])]);
  for (const text of texts) {
    for (const q of quotedNumbers(text)) {
      if (!matchesFigure(q, figureNumbers)) problems.push(`"${q.text}" isn't in figures: every number in the words must be one of the figures (from query_metrics)`);
    }
  }

  if (CAUSE.test(allText)) problems.push(`"${allText.match(CAUSE)![0]}" states a cause as fact: say "coincided with", "likely helped" or "may be linked to"`);
  if (ADVICE.test(allText)) problems.push("that's advice on staffing, pay, loans or tax: share the figures and leave the decision to the owner");

  // Small samples behind a quoted figure are flagged plainly; an answer built on one has low confidence.
  const quoted = new Set(out.figures.map((f) => metricsId(f.source)));
  const small = used.filter((r) => r.available && r.small_sample && quoted.has(r.id));
  if (small.length) {
    if (ctx.task === "answer" && out.confidence !== "low") problems.push("a figure you used has a small sample (see small_sample): confidence must be low");
    if (!SMALL_WORDS.test(allText)) problems.push(`say plainly that the sample is small: ${(small[0] as { small_sample: string }).small_sample}`);
  }

  // A till figure that looks wrong: ask before answering with it (the report flags it).
  const odd = used.flatMap((r) => (r.available ? r.anomalies : []));
  if (odd.length) {
    if (ctx.task === "answer") problems.push(`${odd[0].label} (${odd[0].value.display}) is ${odd[0].times} times the usual ${odd[0].usual.display}: set needs_owner_input and ask the owner to check that till figure before answering`);
    else if (!ASK_WORDS.test(allText)) problems.push(`${odd[0].label} (${odd[0].value.display}) looks wrong (${odd[0].times} times the usual): say it needs checking`);
  }

  if (ctx.task === "answer") {
    const n = sentences(out.content.body).length;
    if (n < 1 || n > 3) problems.push(`answer in 1 to 3 sentences (this has ${n})`);
    if (out.content.actions.length) problems.push("an answer has no actions");
  } else {
    if (!out.content.headline.trim()) problems.push("the report needs a headline");
    else if (sentences(out.content.headline).length > 1 || wordCount(out.content.headline) > 30) problems.push("the headline is one sentence, under 30 words");
    if (sentences(out.content.body).length > 5) problems.push("keep the sales section to 5 sentences at most");
    if (out.content.actions.length !== 3) problems.push(`exactly 3 actions (this has ${out.content.actions.length})`);
    out.content.actions.forEach((a, i) => {
      if (!quotedNumbers(a.why).length) problems.push(`action ${i + 1}'s why must be tied to a number in the report`);
      if (wordCount(a.title) > 8) problems.push(`action ${i + 1}'s title is under 8 words`);
      if (!a.message.trim()) problems.push(`action ${i + 1} needs the WhatsApp message that starts it`);
    });
  }
  return problems;
}

// What the owner reads: the answer, or the report's headline and sales words.
export function insightsText(out: InsightsOutput) {
  if (out.needs_owner_input) return out.needs_owner_input;
  return [out.content.headline, out.content.body, ...out.content.actions.map((a, i) => `${i + 1}. ${a.title}: ${a.why}`)].filter((s) => s.trim()).join("\n");
}
