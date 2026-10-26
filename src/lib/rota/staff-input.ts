// Staff for the rota by WhatsApp: "add Ali, kitchen, £13, weekdays",
// "add Sara, front of house, £12.50, Fri-Sun, 5pm-11pm, max 20 hours",
// "remove Ali from the team", TEAM. No imports beyond ./rules: unit-tested
// (tests/rota-staff-input.test.ts). Saving is in ./staff.ts.
import { isRoleWord, roleKey } from "./rules";

export type StaffInput = {
  name: string;
  roles: string[];
  ratePence: number | null;
  days: number[] | null; // Monday = 1; null = every day
  starts: string | null; // "HH:MM"; null = all day
  ends: string | null;
  maxHours: number | null;
};

export type StaffCommand =
  | { name: "add_rota_staff"; input: StaffInput }
  | { name: "remove_rota_staff"; who: string }
  | { name: "team" };

const DAYS: [RegExp, number[]][] = [
  [/^(every ?day|any ?day|all week|7 days|daily|all days)$/, [1, 2, 3, 4, 5, 6, 7]],
  [/^(weekdays?|mon(day)?\s*(-|–|to)\s*fri(day)?)$/, [1, 2, 3, 4, 5]],
  [/^(weekends?)$/, [6, 7]],
];
const DAY_INDEX: [RegExp, number][] = [
  [/^mon(day)?s?$/, 1],
  [/^tue(s|sday)?s?$/, 2],
  [/^wed(s|nesday)?s?$/, 3],
  [/^thu(r|rs|rsday)?s?$/, 4],
  [/^fri(day)?s?$/, 5],
  [/^sat(urday)?s?$/, 6],
  [/^sun(day)?s?$/, 7],
];
const dayIndex = (w: string) => DAY_INDEX.find(([re]) => re.test(w.trim()))?.[1] ?? null;

// "weekdays", "Fri-Sun", "Mon Wed Fri", "Monday to Thursday" -> [1..7], or null if it isn't days.
export function parseDays(text: string): number[] | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  for (const [re, days] of DAYS) if (re.test(t)) return days;
  const range = t.match(/^([a-z]+)\s*(?:-|–|to|till|until)\s*([a-z]+)$/);
  if (range && dayIndex(range[1]) && dayIndex(range[2])) {
    const a = dayIndex(range[1])!;
    const b = dayIndex(range[2])!;
    const out: number[] = [];
    for (let d = a; d !== b; d = (d % 7) + 1) out.push(d);
    out.push(b);
    return out.sort();
  }
  const words = t.split(/\s*(?:,|&|\/|\band\b|\s)\s*/).filter(Boolean);
  if (!words.length) return null;
  const days = words.map(dayIndex);
  return days.every((d): d is number => d !== null) ? [...new Set(days)].sort() : null;
}

const time24 = (h: number, m: number, ap: string | undefined) => {
  let hour = h;
  if (ap === "pm" && hour < 12) hour += 12;
  if (ap === "am" && hour === 12) hour = 0;
  return hour <= 24 && m < 60 ? `${String(hour % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}` : null;
};

// "5pm-11pm", "12-10pm", "17:00 to 23:00", "evenings", "lunchtimes" -> times, or null.
export function parseTimes(text: string): { starts: string; ends: string } | null {
  const t = text.trim().toLowerCase();
  if (/^(evenings?|nights?)$/.test(t)) return { starts: "17:00", ends: "23:59" };
  if (/^(days?|daytimes?|lunch(times?|es)?)$/.test(t)) return { starts: "11:00", ends: "17:00" };
  const m = t.match(/^(?:from )?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|to|till|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  const endAp = m[6];
  const end = time24(Number(m[4]), Number(m[5] ?? 0), endAp);
  // "12-10pm": the start takes the end's pm only if that keeps it before the end.
  let start = time24(Number(m[1]), Number(m[2] ?? 0), m[3]);
  if (!m[3] && endAp === "pm") {
    const withPm = time24(Number(m[1]), Number(m[2] ?? 0), "pm");
    if (withPm && end && withPm < end) start = withPm;
  }
  if (!start || !end || start === end) return null;
  return { starts: start, ends: end === "00:00" ? "23:59" : end };
}

// "£13", "£12.50", "13ph", "£13/hr", "13.50 an hour" -> pence.
export function parseRate(text: string): number | null {
  const m = text.trim().toLowerCase().match(/^£?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:p\/?h|ph|\/h|\/hr|\/hour|an hour|per hour|a hour|hourly|hr)?$/);
  if (!m || (!text.includes("£") && !/(h|hour|hr)$/.test(text.trim().toLowerCase()))) return null;
  const pence = Math.round(Number(m[1]) * 100);
  return pence > 0 && pence <= 20_000 ? pence : null;
}

// "max 30 hours", "up to 30h", "30 hours a week", "30 hrs max" -> 30.
export function parseMaxHours(text: string): number | null {
  const m = text.trim().toLowerCase().match(/^(?:max(?:imum)?|up to|no more than|at most)?\s*(\d{1,2}(?:\.\d)?)\s*(?:h|hrs?|hours?)(?:\s*(?:a|per|\/)\s*week|\s*max(?:imum)?|\s*pw)?$/);
  if (!m || !/(max|up to|no more|at most|week|pw)/.test(text.toLowerCase())) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 80 ? n : null;
}

const NAME_OK = /^[a-z][a-z' .-]{0,40}$/i;
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());

// Exact staff commands; null = not one (it's treated as chat).
export function parseStaffCommand(body: string): StaffCommand | null {
  const text = body.trim().replace(/[’`]/g, "'").replace(/\s+/g, " ");
  if (/^(team|my team|rota staff|staff list|rota team|show (?:my )?team)[.!]?$/i.test(text)) return { name: "team" };
  const remove = text.match(/^(?:remove|delete|take) ([a-z][a-z' .-]{0,40}?) (?:off|from) (?:the |my )?(?:team|staff|rota|staff list)[.!]?$/i);
  if (remove) return { name: "remove_rota_staff", who: remove[1].trim() };

  // "add Ali, kitchen, £13, weekdays": a name, then comma-separated details, one a role.
  const add = text.match(/^add (?:new )?(?:staff(?: member)?:? )?([^,]+?)\s*(?:,|\bas\b)\s*(.+)$/i);
  if (!add) return null;
  const name = add[1].trim().replace(/[.!]$/, "");
  if (!NAME_OK.test(name) || /^staff$/i.test(name)) return null;
  const input: StaffInput = { name: titleCase(name), roles: [], ratePence: null, days: null, starts: null, ends: null, maxHours: null };
  for (const raw of add[2].split(/\s*,\s*/)) {
    const part = raw.trim().replace(/[.!]$/, "").replace(/^(?:works? |available |on |does |can do )/i, "");
    if (!part) continue;
    const roles = part.split(/\s*(?:\/|&|\band\b|\+)\s*/i);
    if (roles.every((r) => isRoleWord(r))) {
      for (const r of roles) if (!input.roles.includes(roleKey(r))) input.roles.push(roleKey(r));
      continue;
    }
    const rate = parseRate(part);
    if (rate !== null) {
      input.ratePence = rate;
      continue;
    }
    const max = parseMaxHours(part);
    if (max !== null) {
      input.maxHours = max;
      continue;
    }
    // "weekends 5pm-11pm" in one part, or each on its own
    const both = part.match(/^(.+?)\s+((?:from )?\d.+|evenings?|nights?|lunch(?:times?|es)?|daytimes?)$/i);
    const days = parseDays(part) ?? (both ? parseDays(both[1]) : null);
    const times = parseTimes(part) ?? (both ? parseTimes(both[2]) : null);
    if (days || times) {
      if (days) input.days = days;
      if (times) {
        input.starts = times.starts;
        input.ends = times.ends;
      }
      continue;
    }
    return null; // something we can't read: let the assistant handle the message
  }
  return input.roles.length ? { name: "add_rota_staff", input } : null;
}
