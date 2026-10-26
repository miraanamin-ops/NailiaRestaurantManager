// Reading the owner's plain-English rota edits ("Ali can't do Friday", "swap Sara
// and Bilal on Sunday", "give Priya the weekend off", "Mo can do Tuesday") into
// adjustments for the fill (./fill.ts). Anything it can't read is returned as
// unread, for Claude to try (./ai.ts). No imports beyond ./fill and ./types:
// unit-tested (tests/rota-edits.test.ts).
import type { Adjustment } from "./fill";
import type { RotaStaff } from "./types";

export type EditParse = { adjustments: Adjustment[]; unread: string[]; unknownNames: string[] };

const DAY_WORDS: [RegExp, number[]][] = [
  [/^mon(day)?s?$/, [1]],
  [/^tue(s|sday)?s?$/, [2]],
  [/^wed(s|nesday)?s?$/, [3]],
  [/^thu(r|rs|rsday)?s?$/, [4]],
  [/^fri(day)?s?$/, [5]],
  [/^sat(urday)?s?$/, [6]],
  [/^sun(day)?s?$/, [7]],
  [/^weekends?$/, [6, 7]],
  [/^weekdays?$/, [1, 2, 3, 4, 5]],
];

const ALL_WEEK = /\b(all|this|next|the whole|the entire|whole|entire) week\b|\ball week\b|\bany day\b|\bat all\b/;

const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// "Friday", "Fri and Sat", "the weekend", "Monday to Wednesday", "all week" -> the week's dates.
export function datesIn(text: string, weekStart: string): string[] {
  const t = text.toLowerCase();
  if (ALL_WEEK.test(t)) return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const words = t.replace(/[^a-z\s-]/g, " ").split(/[\s]+/).filter(Boolean);
  const dayOf = (w: string) => DAY_WORDS.find(([re]) => re.test(w))?.[1];
  const days = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    // "Mon-Wed"
    const range = words[i].split("-");
    if (range.length === 2 && dayOf(range[0]) && dayOf(range[1])) {
      for (let x = dayOf(range[0])![0]; x <= dayOf(range[1])![0]; x++) days.add(x);
      continue;
    }
    const d = dayOf(words[i]);
    if (!d) continue;
    // "Monday to Wednesday"
    if ((words[i + 1] === "to" || words[i + 1] === "till" || words[i + 1] === "until") && dayOf(words[i + 2] ?? "")) {
      const end = dayOf(words[i + 2])!;
      for (let x = d[0]; x <= end[end.length - 1]; x++) days.add(x);
      i += 2;
      continue;
    }
    for (const x of d) days.add(x);
  }
  return [...days].sort().map((wd) => addDays(weekStart, wd - 1));
}

// A first name as the owner would type it: "Aisha (head chef)" -> "aisha".
export const firstName = (name: string) => name.replace(/\(.*?\)/g, "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

// The staff member a typed name means: the full name, else a unique first name.
export function findStaff<T extends Pick<RotaStaff, "id" | "name">>(staff: T[], typed: string): T | null {
  const t = typed.trim().toLowerCase().replace(/'s$/, "");
  const full = staff.filter((p) => p.name.replace(/\(.*?\)/g, "").trim().toLowerCase() === t);
  if (full.length === 1) return full[0];
  const first = staff.filter((p) => firstName(p.name) === t);
  return first.length === 1 ? first[0] : null;
}

// One word if that works, else two ("Sara K"), so "Sara is off" never reads as a person called "Sara is".
const NAME = "([a-z][a-z'-]*(?: [a-z][a-z'-]*)??)";
const CANT = new RegExp(`^${NAME} (?:can't|cant|can not|cannot|won't|wont|isn't able to|is not able to|is unable to|can no longer)(?: do| work| make it| come in| come| be in)?(?: on)? (.+)$`);
const OFF = new RegExp(`^${NAME} (?:is |'s |will be |needs to be |wants to be )?(?:off|away|on holiday|on leave|not in|not available|unavailable|not working|busy|out)(?: on| for)? (.+)$`);
const NEEDS_OFF = new RegExp(`^${NAME} (?:needs|wants|has asked for|asked for|has|is having) (.+?) off$`);
const GIVE_OFF = new RegExp(`^(?:give|let) ${NAME} (.+?) off$`);
const TAKE_OFF = new RegExp(`^(?:take|remove|drop) ${NAME} (?:off|from)(?: the rota)?(?: on| for)? (.+)$`);
const NO_SHIFT = new RegExp(`^(?:no|don't put|dont put|do not put) ${NAME}(?: on)?(?: on| for)? (.+)$`);
const CAN = new RegExp(`^${NAME} (?:can|is able to|could|is free to|is available to) (?:do|work|come in|cover|be in)(?: on)? (.+)$`);
const FREE = new RegExp(`^${NAME} (?:is |'s )?(?:free|available)(?: on| for)? (.+)$`);
const SWAP = new RegExp(`^(?:please )?swap ${NAME} (?:and|with|for) ${NAME}(?:(?: on| for)? (.+))?$`);
const SWAP2 = new RegExp(`^${NAME} and ${NAME} (?:swap|switch|change over|trade)(?: shifts)?(?:(?: on| for)? (.+))?$`);

// "from 5pm to 11pm" / "5-11pm" / "after 6pm" -> HH:MM (for "can do" edits).
function timesIn(text: string): { starts?: string; ends?: string } {
  const t = text.toLowerCase();
  const to24 = (h: string, m: string | undefined, ap: string | undefined, fallbackPm: boolean) => {
    let hour = Number(h);
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    if (!ap && fallbackPm && hour < 12 && hour > 0 && hour < 8) hour += 12;
    return `${String(hour % 24).padStart(2, "0")}:${m ?? "00"}`;
  };
  const range = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (range) {
    const ap2 = range[6];
    return { starts: to24(range[1], range[2], range[3] ?? (ap2 === "pm" && Number(range[1]) < Number(range[4]) ? "pm" : undefined), true), ends: to24(range[4], range[5], ap2, true) };
  }
  const after = t.match(/(?:after|from)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (after) return { starts: to24(after[1], after[2], after[3], true), ends: "23:59" };
  if (/\bevenings?\b|\bnights?\b/.test(t)) return { starts: "17:00", ends: "23:59" };
  return {};
}

// One message may hold several edits: "Ali can't do Friday, and swap Sara and Bilal on Sunday".
const ONLY_DAYS = /^(?:(?:on|and|or|&|the|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|weekends?|weekdays?)\s*)+$/;

export function splitEdits(message: string) {
  const parts = message
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .split(/[.;!\n]+|,\s*(?:and\s+|also\s+|then\s+)?|\s+(?:and also|also|then|plus)\s+|\s+and\s+(?=(?:swap|give|take|let|no)\b|[a-z'-]+ (?:can|can't|cant|cannot|won't|is|isn't|needs|wants|has)\b)/)
    .map((s) => s.trim().replace(/^(?:and|also|please|pls|oh and)\s+/, "").replace(/\s+please$/, ""))
    .filter(Boolean);
  // "Ali can't do Friday, Saturday": a part that's only days belongs to the one before.
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && ONLY_DAYS.test(p)) out[out.length - 1] += ` and ${p}`;
    else out.push(p);
  }
  return out;
}

export function parseRotaEdits(message: string, staff: Pick<RotaStaff, "id" | "name">[], weekStart: string): EditParse {
  const out: EditParse = { adjustments: [], unread: [], unknownNames: [] };
  for (const part of splitEdits(message)) {
    const swap = part.match(SWAP) ?? part.match(SWAP2);
    if (swap) {
      const a = findStaff(staff, swap[1]);
      const b = findStaff(staff, swap[2]);
      if (!a || !b) {
        out.unknownNames.push(...[!a ? swap[1] : null, !b ? swap[2] : null].filter((x): x is string => Boolean(x)));
        continue;
      }
      const dates = swap[3] ? datesIn(swap[3], weekStart) : datesIn("all week", weekStart);
      if (!dates.length) {
        out.unread.push(part);
        continue;
      }
      out.adjustments.push({ type: "swap", a: a.id, b: b.id, dates });
      continue;
    }
    // Verb-first wordings first, so "take Ali off..." never reads as someone called "take Ali".
    const off = part.match(GIVE_OFF) ?? part.match(TAKE_OFF) ?? part.match(NO_SHIFT) ?? part.match(CANT) ?? part.match(OFF) ?? part.match(NEEDS_OFF);
    const can = off ? null : (part.match(CAN) ?? part.match(FREE));
    const m = off ?? can;
    if (!m) {
      out.unread.push(part);
      continue;
    }
    const p = findStaff(staff, m[1]);
    const dates = datesIn(m[2], weekStart);
    if (!p) {
      out.unknownNames.push(m[1]);
      continue;
    }
    if (!dates.length) {
      out.unread.push(part);
      continue;
    }
    if (off) out.adjustments.push({ type: "unavailable", staffId: p.id, dates });
    else out.adjustments.push({ type: "available", staffId: p.id, dates, ...timesIn(m[2]) });
  }
  return out;
}

// A new edit replaces older ones it contradicts: "Ali can do Friday" after
// "Ali can't do Friday" takes Friday out of the earlier one (and the other way round).
export function mergeAdjustments(existing: Adjustment[], added: Adjustment[]): Adjustment[] {
  let out = [...existing];
  for (const a of added) {
    if (a.type === "unavailable" || a.type === "available") {
      const opposite = a.type === "unavailable" ? "available" : "unavailable";
      out = out
        .map((x) => (x.type === opposite && x.staffId === a.staffId ? { ...x, dates: x.dates.filter((d) => !a.dates.includes(d)) } : x))
        .filter((x) => x.type === "swap" || x.dates.length > 0);
    }
    out.push(a);
  }
  return out;
}

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const weekdayOf = (ymd: string) => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

function daysText(dates: string[]) {
  if (dates.length === 7) return "all week";
  return dates.map((d) => DAY_NAMES[weekdayOf(d)]).join(", ");
}

// "Ali off Friday", "Sara and Bilal swapped on Sunday": what was understood, for the reply.
export function describeAdjustment(a: Adjustment, staff: Pick<RotaStaff, "id" | "name">[]) {
  const name = (id: string) => staff.find((p) => p.id === id)?.name ?? "someone";
  if (a.type === "swap") return `${name(a.a)} ⇄ ${name(a.b)} ${a.dates.length === 7 ? "all week" : `on ${daysText(a.dates)}`}`;
  if (a.type === "unavailable") return `${name(a.staffId)} off ${daysText(a.dates)}`;
  return `${name(a.staffId)} can work ${daysText(a.dates)}${a.starts && a.ends ? ` (${a.starts}–${a.ends === "23:59" ? "close" : a.ends})` : ""}`;
}
