// Saved GM cases (agents/tests/gm/): routing.json (owner messages and the route
// each should reach) and composer/*.json (briefs, cards, alerts, replies and the
// Monday message, with everything the composer is given and what a right message
// must do), with the recorded answers.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { composerProblems, expectedLanguage, numbersFrom, type ComposeKind, type ComposerContext, type ComposerOutputType, type LanguageSeen, type Route, type RouterOutputType } from "@/lib/agents/gm-rules";

export const GM_DIR = join("agents", "tests", "gm");

export type RoutingCase = { message: string; routes: Route[]; note?: string };
export type RoutingFile = { about: string; cases: RoutingCase[]; recorded?: { results: { message: string; output: RouterOutputType }[]; recorded_at: string } | null };

export function loadRouting(): RoutingFile {
  return JSON.parse(readFileSync(join(GM_DIR, "routing.json"), "utf8"));
}

export function saveRoutingRecorded(recorded: RoutingFile["recorded"]) {
  const f = loadRouting();
  writeFileSync(join(GM_DIR, "routing.json"), `${JSON.stringify({ ...f, recorded }, null, 2)}\n`);
}

export type ComposerCase = {
  name: string;
  source: string;
  kind: ComposeKind;
  owner: { owner_name: string; language: string; restaurant: string };
  owner_message?: string;
  receipts?: string[];
  cards?: { what: string; audience: string }[];
  draft?: { kind: string; audience: string; content: string; expected_outcome: string | null };
  profile?: Record<string, unknown>;
  report?: { headline: string; top_action: string; url: string };
  expect: { mention_any?: string[]; must_not_contain?: string[]; language?: LanguageSeen };
  recorded: { output: ComposerOutputType; recorded_at: string } | null;
};

const COMPOSER_DIR = join(GM_DIR, "composer");

export function loadComposerCases() {
  return readdirSync(COMPOSER_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, case: JSON.parse(readFileSync(join(COMPOSER_DIR, file), "utf8")) as ComposerCase }));
}

export function saveComposerRecorded(file: string, recorded: ComposerCase["recorded"]) {
  const path = join(COMPOSER_DIR, file);
  const c = JSON.parse(readFileSync(path, "utf8")) as ComposerCase;
  writeFileSync(path, `${JSON.stringify({ ...c, recorded }, null, 2)}\n`);
}

// What the composer is given (everything but the expectation and the recorded answer).
export function composerData(c: ComposerCase) {
  return { owner: c.owner, owner_message: c.owner_message ?? null, receipts: c.receipts ?? [], cards: c.cards ?? [], draft: c.draft ?? null, profile: c.profile ?? null, report: c.report ?? null };
}

export function composerContext(c: ComposerCase): ComposerContext {
  const data = composerData(c);
  return {
    kind: c.kind,
    allowedNumbers: [...numbersFrom(JSON.stringify(data)), (c.cards ?? []).length],
    language: expectedLanguage({ ownerMessage: c.owner_message ?? null, profileLanguage: c.owner.language }),
  };
}

export function judgeComposer(c: ComposerCase, out: ComposerOutputType) {
  const problems = composerProblems(out, composerContext(c));
  const text = out.message.toLowerCase();
  if (c.expect.mention_any?.length && !c.expect.mention_any.some((w) => text.includes(w.toLowerCase()))) problems.push(`should mention one of: ${c.expect.mention_any.join(", ")}`);
  for (const w of c.expect.must_not_contain ?? []) if (text.includes(w.toLowerCase())) problems.push(`must not contain "${w}"`);
  return problems;
}
