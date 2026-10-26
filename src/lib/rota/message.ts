// What the owner reads about a suggested rota on WhatsApp: the draft card (with
// Approve / Edit / Skip, at most 1024 characters), who's on each day (a plain
// message before it), and the published links. Plain code (pure imports only):
// unit-tested (tests/rota-fill.test.ts).
import { dayLabel, gbp } from "@/lib/sales/format";
import { clip, plural } from "@/lib/text";
import { dayShort, type RotaPlan } from "./fill";
import { firstName } from "./edits";
import { ROLES, shortSpan } from "./rules";

export const money = (pence: number) => gbp(Math.round(pence / 100));
export const pct = (n: number | null) => (n === null ? "no forecast" : `${n.toFixed(1)}%`);

// "Mon 2 – Sun 8 Nov"
export function weekLabel(weekStart: string) {
  const end = new Date(Date.parse(`${weekStart}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const a = dayLabel(weekStart);
  const b = dayLabel(end);
  return a.split(" ")[2] === b.split(" ")[2] ? `${a.split(" ").slice(0, 2).join(" ")} – ${b}` : `${a} – ${b}`;
}

export const MINIMUM_NOTE =
  "Built from your opening hours and minimum staffing only: there's less than 8 weeks of sales history, so I can't staff to a forecast yet.";

export type Previous = { weekStart: string; costPence: number; hours: number } | null;

// The draft card: summary, labour %, a line per day, anything to check.
export function rotaDraftText(weekStart: string, plan: RotaPlan, opts: { previous?: Previous; understood?: string[] } = {}) {
  const t = plan.totals;
  const lines: string[] = [`🗓️ *Rota for next week* (${weekLabel(weekStart)})`];
  if (opts.understood?.length) lines.push(`✏️ Changed: ${opts.understood.join("; ")}`);
  if (plan.basis === "minimum") lines.push(`ℹ️ ${MINIMUM_NOTE}`);
  else {
    const orders = plan.days.reduce((n, d) => n + (d.orders ?? 0), 0);
    lines.push(`📈 Staffed to your forecast: about ${orders.toLocaleString("en-GB")} orders${t.salesPence ? `, ${money(t.salesPence)} sales` : ""}.`);
  }
  const people = plan.byStaff.length;
  lines.push(
    `💷 Labour *${money(t.costPence)}*${t.labourPct !== null ? ` · *${pct(t.labourPct)}* of forecast sales` : ""} · ${t.hours} hours · ${plural(people, "person", "people")}`,
  );
  if (t.openShiftHours) lines.push(`_Includes ${t.openShiftHours} hours of open shifts nobody could take, costed at the average rate._`);
  if (t.labourPct !== null && t.salesDays < t.openDays) lines.push(`_(labour % over the ${t.salesDays} days with a sales forecast)_`);
  if (opts.previous) {
    const diff = t.costPence - opts.previous.costPence;
    lines.push(`Last approved rota (w/c ${dayLabel(opts.previous.weekStart)}): ${money(opts.previous.costPence)}${diff ? ` (${diff > 0 ? "+" : "−"}${money(Math.abs(diff))})` : ""}`);
  }
  lines.push("");
  for (const d of plan.days) {
    if (!d.open.length) lines.push(`${dayShort(d.weekday)} closed`);
    else lines.push(`${dayShort(d.weekday)} ${money(d.costPence)}${d.labourPct !== null ? ` · ${pct(d.labourPct)}` : ""} · ${d.hours}h`);
  }
  const checks = [...plan.notes.map((n) => `- ${n}`), ...plan.flags.map((f) => `- ${f.text}`)];
  if (checks.length) {
    lines.push("", "⚠️ *To check*");
    lines.push(...checks.slice(0, 4));
    if (checks.length > 4) lines.push(`- …and ${checks.length - 4} more (on the rota page once approved)`);
  }
  lines.push("", `Tap *Edit* or just tell me, e.g. _Ali can't do Friday_ or _swap Sara and Bilal on Sunday_.`);
  const text = lines.join("\n");
  // The card has to fit WhatsApp's 1024-character limit for buttons: drop the checks before anything else.
  if (text.length <= 1000) return text;
  const short = lines.filter((l) => !l.startsWith("- ")).join("\n").replace("⚠️ *To check*", `⚠️ *${plural(checks.length, "thing")} to check* (see the list above)`);
  return clip(short, 1000);
}

const ROLE_SHORT: Record<string, string> = { kitchen: "K", front: "F", delivery: "D", manager: "M" };

// Who's on each day, by role: "*Mon* K Tomasz 12–22, Mo 12–22 · F Sam 12–22".
export function rotaDetailText(weekStart: string, plan: RotaPlan) {
  const lines = [`👥 *Who's on* (draft, ${weekLabel(weekStart)}) · K kitchen, F front of house${plan.days.some((d) => d.shifts.some((s) => s.role === "delivery")) ? ", D delivery" : ""}${plan.days.some((d) => d.shifts.some((s) => s.role === "manager")) ? ", M manager" : ""}`];
  for (const d of plan.days) {
    if (!d.open.length) {
      lines.push(`*${dayShort(d.weekday)}* closed`);
      continue;
    }
    const rank = (r: string) => ((ROLES as readonly string[]).indexOf(r) + ROLES.length + 1) % (ROLES.length + 1);
    const roles = [...new Set(d.shifts.map((s) => s.role))].sort((a, b) => rank(a) - rank(b));
    const parts = roles.map((role) => {
      const who = d.shifts
        .filter((s) => s.role === role)
        .map((s) => `${s.name ? capital(firstName(s.name)) : "OPEN"} ${shortSpan(s.start, s.end)}`)
        .join(", ");
      return `${ROLE_SHORT[role] ?? role} ${who}`;
    });
    lines.push(`*${dayShort(d.weekday)}* ${parts.join(" · ") || "nobody needed"}`);
  }
  return clip(lines.join("\n"), 1590);
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function publishedText(weekStart: string, url: string) {
  return [
    `✅ *Rota approved* for ${weekLabel(weekStart)}.`,
    `🔗 Share this with your team (view only): ${url}`,
    `📄 PDF to forward: ${url}/pdf`,
  ].join("\n");
}
