// Pure rules for the owner pages (home, approvals, sales, customers): numbers in,
// words and shapes out. No database, no AI, so every line is unit-tested
// (tests/dashboard-rules.test.ts).

export type Direction = "up" | "down" | "same";
export type Change = { now: number; before: number; pct: number | null; dir: Direction };

// This period against the one before. pct is null when there's nothing to compare with.
export function compare(now: number, before: number): Change {
  const pct = before > 0 ? Math.round(((now - before) / before) * 100) : null;
  const dir: Direction = now > before ? "up" : now < before ? "down" : "same";
  return { now, before, pct, dir };
}

// "▲ 6%", "▼ 3", "Same as last week". Counts show the difference, money and rates the %.
export function changeLabel(c: Change, mode: "pct" | "diff" = "pct", unit = "") {
  if (c.dir === "same") return "Same as last week";
  const arrow = c.dir === "up" ? "▲" : "▼";
  if (mode === "pct" && c.pct !== null) return `${arrow} ${Math.abs(c.pct)}%`;
  const diff = Math.abs(c.now - c.before);
  return `${arrow} ${Number.isInteger(diff) ? diff : diff.toFixed(1)}${unit}`;
}

export function greeting(londonHour: number) {
  if (londonHour < 12) return "Morning";
  if (londonHour < 18) return "Afternoon";
  return "Evening";
}

export function firstName(name: string | null | undefined) {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first[0].toUpperCase() + first.slice(1) : null;
}

export function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// A forecast day against a normal day of the same weekday.
export type Busyness = "quiet" | "normal" | "busy" | "closed" | "unknown";
export function busyness(likely: number | null, normal: number | null): Busyness {
  if (likely === null) return "unknown";
  if (likely === 0) return "closed";
  if (!normal) return "normal";
  const ratio = likely / normal;
  if (ratio <= 0.85) return "quiet";
  if (ratio >= 1.15) return "busy";
  return "normal";
}

// The one sentence under the greeting: what needs the owner and what today looks like.
export function todaySummary(input: { waiting: number; urgent: number; forecastOrders: number | null; busy: Busyness; event: string | null }) {
  const parts: string[] = [];
  if (input.busy === "quiet") parts.push("A quieter day than usual is expected");
  else if (input.busy === "busy") parts.push("A busier day than usual is expected");
  else if (input.forecastOrders !== null && input.busy !== "closed") parts.push("A normal day is expected");
  if (input.urgent) parts.push(`${input.urgent === 1 ? "1 thing needs" : `${input.urgent} things need`} attention now`);
  else if (input.waiting) parts.push(`${input.waiting === 1 ? "1 thing is" : `${input.waiting} things are`} waiting for you`);
  else parts.push("nothing is waiting for you");
  let text = parts.join(", and ");
  text = text[0].toUpperCase() + text.slice(1);
  return `${text}.${input.event ? ` ${input.event} today.` : ""}`;
}

// What the website may decide itself. Questions, the assistant's own cards (facts,
// ideas, rotas) and drafts inside a business review need their WhatsApp conversation.
const WHATSAPP_ONLY = new Set(["review_question", "hours_question", "agent_question", "choice", "profile_change", "special_idea", "rota"]);
export function decidableOnWeb(d: { kind: string; business_review_id?: string | null }) {
  return !WHATSAPP_ONLY.has(d.kind) && !d.business_review_id;
}

// WhatsApp formatting (*bold*, _italic_, ~strike~) off, for the web.
export function plainText(s: string) {
  return s.replace(/[*_~]([^*_~\n]+)[*_~]/g, "$1").replace(/[*_~]/g, "");
}

// An SVG path through the values, in a w x h box (the top is the biggest value).
export function sparkPath(values: number[], w = 100, h = 28) {
  if (values.length < 2) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - 2 - ((v - min) / span) * (h - 4);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

// Busiest hours: a weekday (Mon=0) x hour grid of levels 0 (quiet) to 4 (busiest),
// from per-hour sales. Hours outside [from, to] are left out.
export function heatmap(rows: { weekday: number; hour: number; value: number }[], from = 12, to = 23) {
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const sums = Array.from({ length: 7 }, () => hours.map(() => 0));
  for (const r of rows) {
    const h = r.hour - from;
    if (h < 0 || h >= hours.length || r.weekday < 0 || r.weekday > 6) continue;
    sums[r.weekday][h] += r.value;
  }
  const max = Math.max(0, ...sums.flat());
  const levels = sums.map((row) => row.map((v) => (max ? Math.min(4, Math.ceil((v / max) * 4)) : 0)));
  return { hours, levels, empty: max === 0 };
}

// Best sellers from till lines: quantity and money per dish, biggest money first.
export function topDishes(lines: { item: string; quantity: number; amount: number }[], n = 5) {
  const by = new Map<string, { item: string; sold: number; amount: number }>();
  for (const l of lines) {
    const key = l.item.trim().toLowerCase();
    const row = by.get(key) ?? { item: l.item.trim(), sold: 0, amount: 0 };
    row.sold += Number(l.quantity) || 0;
    row.amount += Number(l.amount) || 0;
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}

// A person's name for the owner's lists: first name and initial ("Priya S.").
export function shortName(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "A customer";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

// "9:14am", in London.
export function londonClock(iso: string) {
  return new Date(iso)
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" })
    .replace(" ", "")
    .toLowerCase();
}

// "2 hours ago", "yesterday", "3 days ago".
export function ago(iso: string, now: Date) {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// Open-Meteo's weather code in a word or two.
export function weatherWords(code: number | null | undefined) {
  if (code === null || code === undefined) return null;
  if (code === 0) return "Clear";
  if (code <= 2) return "Some cloud";
  if (code === 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  return "Storms";
}

// True if a birthday ("YYYY-MM-DD", any year) falls on the given London day ("YYYY-MM-DD").
export function birthdayOn(birthday: string | null, ymd: string) {
  return Boolean(birthday && birthday.slice(5, 10) === ymd.slice(5, 10));
}

const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const longDay = (ymd: string) => LONG_DAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()];

// One sentence about a week of takings: where the money came from, and the gap.
// Needs at least 5 days with sales, else null (too little to say anything).
export function salesHeadline(days: { day: string; net: number }[]) {
  const open = days.filter((d) => d.net > 0);
  if (open.length < 5) return null;
  const total = open.reduce((s, d) => s + d.net, 0);
  const sorted = [...open].sort((a, b) => b.net - a.net);
  const top = sorted.slice(0, 2).sort((a, b) => a.day.localeCompare(b.day));
  const low = sorted.slice(-2).sort((a, b) => a.day.localeCompare(b.day));
  const share = Math.round(((top[0].net + top[1].net) / total) * 100);
  return `${longDay(top[0].day)} and ${longDay(top[1].day)} did ${share}% of the takings. ${longDay(low[0].day)} and ${longDay(low[1].day)} were the quietest.`;
}
