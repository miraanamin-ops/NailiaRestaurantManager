// What the owner reads about a suggested rota on WhatsApp: the week day by day
// (who's on, in 12-hour times, with each day's cost and labour %), then the
// summary card with Approve / Edit / Skip (at most 1024 characters) and a link
// to the full grid; and the published links. Plain code (pure imports only):
// unit-tested (tests/rota-fill.test.ts).
import { dayLabel, gbp } from "@/lib/sales/format";
import { clip, plural } from "@/lib/text";
import { type RotaPlan } from "./fill";
import { firstName } from "./edits";
import { ROLES, span12, time12 } from "./rules";

export const money = (pence: number) => gbp(Math.round(pence / 100));
export const pct = (n: number | null) => (n === null ? "no forecast" : `${n.toFixed(1)}%`);
const wholePct = (n: number) => `${Math.round(n)}%`;

// "Mon 2 – Sun 8 Nov"
export function weekLabel(weekStart: string) {
  const end = new Date(Date.parse(`${weekStart}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const a = dayLabel(weekStart);
  const b = dayLabel(end);
  return a.split(" ")[2] === b.split(" ")[2] ? `${a.split(" ").slice(0, 2).join(" ")} – ${b}` : `${a} – ${b}`;
}

export { span12, time12 };

export const MINIMUM_NOTE =
  "Built from your opening hours and minimum staffing only: there's less than 8 weeks of sales history, so I can't staff to a forecast yet.";

export type Previous = { weekStart: string; costPence: number; hours: number } | null;

const ROLE_ICON: Record<string, string> = { manager: "🧑‍💼", kitchen: "👨‍🍳", front: "🍽️", delivery: "🛵" };
const rank = (r: string) => ((ROLES as readonly string[]).indexOf(r) + ROLES.length + 1) % (ROLES.length + 1);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// "*Mon 2* · £351 · 29%", then a line per role: "👨‍🍳 Ali 12pm–5:30pm, Tom 5:30pm–11pm".
function dayBlock(d: RotaPlan["days"][number]) {
  const head = `*${dayLabel(d.date).split(" ").slice(0, 2).join(" ")}*`;
  if (!d.open.length) return `${head} · closed`;
  const lines = [`${head} · ${money(d.costPence)}${d.labourPct !== null ? ` · ${wholePct(d.labourPct)}` : ""}`];
  const roles = [...new Set(d.shifts.map((s) => s.role))].sort((a, b) => rank(a) - rank(b));
  for (const role of roles) {
    const who = d.shifts.filter((s) => s.role === role).map((s) => (s.name ? `${capital(firstName(s.name))} ${span12(s.start, s.end)}` : `⚠️ open ${span12(s.start, s.end)}`));
    lines.push(`${ROLE_ICON[role] ?? "•"} ${who.join(", ")}`);
  }
  if (!roles.length) lines.push("Nobody needed");
  return lines.join("\n");
}

// The week, day by day: one message (or two if it's long, WhatsApp's 1600-character limit).
export function rotaWeekMessages(weekStart: string, plan: RotaPlan) {
  const blocks = plan.days.map(dayBlock);
  const head = `🗓️ *Next week's rota* · ${weekLabel(weekStart)} _(draft)_`;
  const one = [head, ...blocks].join("\n\n");
  if (one.length <= 1590) return [one];
  return [[head, ...blocks.slice(0, 4)].join("\n\n"), blocks.slice(4).join("\n\n")].map((t) => clip(t, 1590));
}

// The summary card under it: the week's labour, anything to check, the full grid, the buttons.
export function rotaDraftText(weekStart: string, plan: RotaPlan, opts: { previous?: Previous; understood?: string[]; previewUrl?: string | null } = {}) {
  const t = plan.totals;
  const lines: string[] = [];
  if (opts.understood?.length) lines.push(`✏️ Changed: ${opts.understood.join("; ")}`, "");
  lines.push(`💷 *${money(t.costPence)} labour${t.labourPct !== null ? ` · ${wholePct(t.labourPct)} of forecast sales` : ""}* for ${weekLabel(weekStart)}`);
  const orders = plan.days.reduce((n, d) => n + (d.orders ?? 0), 0);
  if (plan.basis === "minimum") lines.push(`ℹ️ ${MINIMUM_NOTE}`);
  else lines.push(`📈 Staffed to your forecast: about ${orders.toLocaleString("en-GB")} orders${t.salesPence ? `, ${money(t.salesPence)} sales` : ""}`);
  lines.push(`👥 ${t.hours} hours · ${plural(plan.byStaff.length, "person", "people")}`);
  if (t.openShiftHours) lines.push(`_Includes ${t.openShiftHours} hours of open shifts nobody could take, costed at the average rate._`);
  if (t.labourPct !== null && t.salesDays < t.openDays) lines.push(`_(labour % over the ${t.salesDays} days with a sales forecast)_`);
  if (opts.previous) {
    const diff = t.costPence - opts.previous.costPence;
    lines.push(`Last approved rota (w/c ${dayLabel(opts.previous.weekStart)}): ${money(opts.previous.costPence)}${diff ? ` (${diff > 0 ? "+" : "−"}${money(Math.abs(diff))})` : ""}`);
  }
  const checks = [...plan.notes.map((n) => `- ${n}`), ...plan.flags.map((f) => `- ${f.text}`)];
  if (checks.length) {
    lines.push("", "⚠️ *To check*");
    lines.push(...checks.slice(0, 4));
    if (checks.length > 4) lines.push(`- …and ${checks.length - 4} more (in the full rota)`);
  }
  if (opts.previewUrl) lines.push("", `📊 Full rota grid: ${opts.previewUrl}`);
  lines.push("", `Tap *Edit* or just tell me what to change, e.g. _Ali can't do Friday_.`);
  const text = lines.join("\n");
  // The card has to fit WhatsApp's 1024-character limit for buttons: the checks give way first.
  if (text.length <= 1000) return text;
  const short = lines.filter((l) => !l.startsWith("- ")).join("\n").replace("⚠️ *To check*", `⚠️ *${plural(checks.length, "thing")} to check* (in the full rota)`);
  return clip(short, 1000);
}

export function publishedText(weekStart: string, url: string) {
  return [
    `✅ *Rota approved* for ${weekLabel(weekStart)}.`,
    `🔗 Share this with your team (view only): ${url}`,
    `📄 PDF to forward: ${url}/pdf`,
  ].join("\n");
}
