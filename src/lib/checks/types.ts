// The four checks every draft goes through, and what each one found.
// Plain code with no imports, so it's unit-tested (tests/checks.test.ts).
//
//   tone        Brand and tone (AI): the restaurant's voice and language
//   facts       Facts (AI): prices, hours, dishes and offers match the profile
//   compliance  Compliance (code): consent at send time, unsubscribe link, no misleading claims
//   money       Money and risk (code): discount cap, send window, no duplicates, PAUSE

export const CHECK_NAMES = ["tone", "facts", "compliance", "money"] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export const CHECK_LABELS: Record<CheckName, string> = {
  tone: "Brand & tone",
  facts: "Facts",
  compliance: "Compliance",
  money: "Money & risk",
};

// pass: all fine. fixed: the check corrected something. flagged: for the owner to decide.
// failed: the check couldn't run. held: waiting (e.g. outside sending hours). blocked: stopped the send.
export type CheckStatus = "pass" | "fixed" | "flagged" | "failed" | "held" | "blocked";

export type CheckResult = { status: CheckStatus; fixes: string[]; flags: string[]; at: string };

// Draft time: all four. Send time: the two code checks run again, right before sending.
export type DraftChecks = Partial<Record<CheckName, CheckResult>> & {
  send?: Partial<Record<"compliance" | "money", CheckResult>>;
};

const ICONS: Record<CheckStatus, string> = { pass: "✅", fixed: "🔧", flagged: "⚠️", failed: "❓", held: "🕘", blocked: "⛔" };

export function checkResult(fixes: string[], flags: string[], status?: CheckStatus): CheckResult {
  return {
    status: status ?? (flags.length ? "flagged" : fixes.length ? "fixed" : "pass"),
    fixes,
    flags,
    at: new Date().toISOString(),
  };
}

export function passed(r: CheckResult | undefined) {
  return r ? r.status === "pass" || r.status === "fixed" : false;
}

// "✅ Brand & tone · 🔧 Facts · ⚠️ Compliance · ✅ Money & risk"
export function checksLine(checks: DraftChecks) {
  return CHECK_NAMES.filter((n) => checks[n])
    .map((n) => `${ICONS[checks[n]!.status]} ${CHECK_LABELS[n]}`)
    .join(" · ");
}

// One line per fix or flag, saying which check it came from.
export function checkNoteLines(checks: DraftChecks) {
  const lines: string[] = [];
  for (const n of CHECK_NAMES) {
    const r = checks[n];
    if (!r) continue;
    for (const f of r.fixes) lines.push(`🔍 _${CHECK_LABELS[n]} fixed: ${f}_`);
    for (const f of r.flags) lines.push(`⚠️ _${CHECK_LABELS[n]}: ${f}_`);
  }
  return lines;
}

// Everything fixed or flagged, all checks together (the older check_notes shape).
export function allNotes(checks: DraftChecks) {
  return {
    fixes: CHECK_NAMES.flatMap((n) => checks[n]?.fixes ?? []),
    flags: CHECK_NAMES.flatMap((n) => checks[n]?.flags ?? []),
  };
}
