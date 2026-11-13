// The founder's Monday email, as plain code (tests/founder-metrics.test.ts).
import { pct, pounds } from "./metrics";

// The UK date if it's a Monday from 8am and this Monday's hasn't gone, else null.
export function weeklyDue(now: Date, lastSentOn: string | null): string | null {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (parts.weekday !== "Mon" || Number(parts.hour) < 8) return null;
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return lastSentOn === today ? null : today;
}

type Overview = {
  counts: { active: number; trialing: number; paying: number; pilot: number; inSetup: number; pastDue: number };
  months: { label: string; newClients: number; churned: number; payingAtStart: number; churnRate: number | null; trialsEnded: number; converted: number; conversionRate: number | null }[];
  mrr: { afterFeesPence: number };
  aiThisMonthUsd: number;
  attention: { r: { name: string }; health: { light: string; reasons: { text: string }[] } }[];
  trialsEnding: { r: { name: string }; trialEndsAt: string | null; approvals7d: number }[];
};

export function weeklyText(o: Overview, base: string) {
  const cur = o.months[o.months.length - 1];
  const prev = o.months[o.months.length - 2];
  const lines = [
    `Active clients: ${o.counts.active} (${o.counts.paying} paying, ${o.counts.trialing} on trial, ${o.counts.pilot} pilot or free). ${o.counts.inSetup} in setup.`,
    `MRR: ${pounds(o.mrr.afterFeesPence)} after store fees.`,
    `New this month: ${cur.newClients}. Last month: paid churn ${pct(prev.churnRate)} (${prev.churned} of ${prev.payingAtStart}), trial to paid ${pct(prev.conversionRate)} (${prev.converted} of ${prev.trialsEnded}).`,
    `Claude this month so far: $${o.aiThisMonthUsd.toFixed(2)}.`,
    o.counts.pastDue ? `${o.counts.pastDue} failed payment${o.counts.pastDue === 1 ? "" : "s"}.` : "",
    "",
    o.attention.length ? "Needs attention:" : "Nobody needs attention.",
    ...o.attention.slice(0, 10).map((c) => `- ${c.r.name}: ${c.health.reasons.map((r) => r.text).join("; ")}`),
    o.trialsEnding.length ? "" : "",
    o.trialsEnding.length ? "Trials ending in the next 14 days:" : "",
    ...o.trialsEnding.slice(0, 10).map((c) => `- ${c.r.name}: ends ${c.trialEndsAt?.slice(0, 10)}, ${c.approvals7d} approvals this week`),
    "",
    `The dashboard: ${base}/admin`,
  ].filter((l, i, all) => l !== "" || (all[i - 1] !== "" && i > 0));
  return { subject: `DinerAI this week: ${o.counts.paying} paying, ${pounds(o.mrr.afterFeesPence)} MRR`, text: lines.join("\n") };
}
