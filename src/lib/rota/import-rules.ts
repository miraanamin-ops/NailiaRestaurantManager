// Past rotas read at setup, and the staffing card (owner's plan, 12 Nov 2026):
// the plain-code parts. Claude only reads the rota files into rows (./import.ts);
// everything here is code: placing each shift on a date, the table the owner
// checks, the "How many people you need" rows, and reading a typed change like
// "2 chefs, a porter only when busy". No imports beyond ./rules, ./presets,
// ./learn: unit-tested (tests/rota-learn.test.ts).
import { isOpenShift, type ImportedShift, type Learned, type LearnedRole } from "./learn";
import { ROLE_SHAPE, SEAT_WORDS, type Suggestion } from "./presets";
import { DRIVER_WORDS, isRoleWord, ROLE_DEFS, roleKey, roleLabel, type Driver } from "./rules";
import type { RotaRule } from "./types";

// ---------- Placing shifts on dates ----------

export type ReadShift = {
  name: string;
  role: string | null;
  date: string | null;
  weekday: number | null;
  start: string;
  end: string;
};
export type ReadWeek = { week_start: string | null; shifts: ReadShift[]; hours_shown?: { name: string; hours: number }[] };

// The people whose shifts as read don't add up to the hours the rota prints for
// them (a row read against the wrong name on a skewed photo shows up here), for the
// check card to name. Only where the rota has an hours column.
export function hoursDoubts(weeks: ReadWeek[]): string[] {
  const out = new Set<string>();
  for (const w of weeks) {
    for (const shown of w.hours_shown ?? []) {
      const name = shown.name.trim().toLowerCase();
      if (!name || !Number.isFinite(shown.hours)) continue;
      const minutes = w.shifts
        .filter((s) => s.name.trim().toLowerCase() === name)
        .reduce((n, s) => {
          const a = minutesOf(s.start);
          let b = minutesOf(s.end);
          if (a === null || b === null) return n;
          if (b <= a) b += 1440;
          return n + (b - a);
        }, 0);
      if (Math.abs(minutes / 60 - shown.hours) > 0.26) out.add(shown.name.trim());
    }
  }
  return [...out];
}

const namesList = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

const DAY_MS = 86_400_000;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (ymd: string) => ((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const mondayOf = (ymd: string) => addDays(ymd, 1 - weekdayOf(ymd));
const isYmd = (s: string | null | undefined): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)));

// "17:30" -> 1050; "24:00" -> 1440. null if it isn't a time.
export function minutesOf(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min < 60 ? h * 60 + min : null;
}

// Every shift on a date: its own date if the rota showed one, else its week's
// Monday plus the weekday. A rota with no dates at all is taken as the most
// recent whole weeks before today, in the order sent (the last one sent = last
// week); `assumed` says so, and the check card tells the owner.
export function placeShifts(weeks: ReadWeek[], today: string): { shifts: ImportedShift[]; assumed: boolean; unplaced: number } {
  const lastMonday = addDays(mondayOf(today), -7);
  const undated = weeks.filter((w) => !isYmd(w.week_start) && !w.shifts.some((s) => isYmd(s.date)));
  let assumed = false;
  const shifts: ImportedShift[] = [];
  let unplaced = 0;
  weeks.forEach((w) => {
    const u = undated.indexOf(w);
    const monday = isYmd(w.week_start) ? mondayOf(w.week_start) : u >= 0 ? addDays(lastMonday, -7 * (undated.length - 1 - u)) : null;
    if (u >= 0) assumed = true;
    for (const s of w.shifts) {
      const date = isYmd(s.date) ? s.date : monday && s.weekday && s.weekday >= 1 && s.weekday <= 7 ? addDays(monday, s.weekday - 1) : null;
      const start = minutesOf(s.start);
      let end = minutesOf(s.end);
      if (!date || start === null || end === null || !s.name.trim() || date > today) {
        unplaced++;
        continue;
      }
      if (end <= start) end += 1440; // past midnight
      if (end - start > 16 * 60) {
        unplaced++;
        continue;
      }
      shifts.push({
        name: s.name.trim().replace(/\s+/g, " "),
        role: s.role?.trim() ? roleKey(s.role) : "unknown",
        date,
        start,
        end,
      });
    }
  });
  // The same person twice at the same time is one shift (a rota photographed twice).
  const seen = new Set<string>();
  const unique = shifts.filter((s) => {
    const k = `${s.name.toLowerCase()}|${s.date}|${s.start}|${s.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    shifts: unique.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.name.localeCompare(b.name)),
    assumed,
    unplaced,
  };
}

// ---------- The check card ----------

const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const t12 = (m: number) => {
  const w = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(w / 60);
  const min = w % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${min ? `:${String(min).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};
const longDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export type CheckTable = { columns: string[]; rows: string[][] };

// One row per person: role, shifts read, the days and times they usually work.
export function checkTable(shifts: ImportedShift[], learned: Learned | null): CheckTable {
  const people = learned?.people ?? [];
  return {
    columns: ["Name", "Role", "Shifts", "Usually"],
    rows: people.map((p) => {
      const mine = shifts.filter((s) => s.name === p.name);
      const days = p.days.length ? p.days.map((d) => DAY_SHORT[d]).join(" ") : "varies";
      const typical = mine.length ? `${t12(Math.min(...mine.map((s) => s.start)))} to ${t12(Math.max(...mine.map((s) => s.end)))}` : "";
      return [p.name, p.role === "unknown" ? "Not shown" : roleLabel(p.role), String(p.shifts), `${days}${typical ? `, ${typical}` : ""}`];
    }),
  };
}

// "I read 3 weeks (20 Oct to 9 Nov): 9 people and 84 shifts."
export function checkSummary(input: { shifts: ImportedShift[]; weeks: number; assumed: boolean; unplaced: number; unknownRoles: number; doubts?: string[] }) {
  const { shifts } = input;
  if (!shifts.length) return "I couldn't read any shifts from that.";
  const people = new Set(shifts.map((s) => s.name).filter((n) => !isOpenShift(n))).size;
  const from = shifts[0].date;
  const to = shifts[shifts.length - 1].date;
  const parts = [
    `I read ${input.weeks} week${input.weeks === 1 ? "" : "s"} (${longDate(mondayOf(from))} to ${longDate(to)}): ${people} ${people === 1 ? "person" : "people"} and ${shifts.length} shifts.`,
  ];
  if (input.assumed) parts.push(`I couldn't see dates on it, so I've taken it as your last ${input.weeks === 1 ? "week" : `${input.weeks} weeks`}.`);
  if (input.unplaced) parts.push(`${input.unplaced} shift${input.unplaced === 1 ? "" : "s"} I couldn't read clearly, so I left ${input.unplaced === 1 ? "it" : "them"} out.`);
  if (input.unknownRoles) parts.push(`The rota didn't say what ${input.unknownRoles === 1 ? "one person does" : `${input.unknownRoles} people do`}: tell me, or I'll ask when we do your team.`);
  if (input.doubts?.length)
    parts.push(`${namesList(input.doubts.slice(0, 5))}${input.doubts.length > 5 ? ` and ${input.doubts.length - 5} more` : ""} ${input.doubts.length === 1 ? "doesn't" : "don't"} add up to the hours on your rota, so please check ${input.doubts.length === 1 ? "that row" : "those rows"} first.`);
  parts.push("Is this right?");
  return parts.join(" ");
}

// ---------- The staffing card ----------

export type StaffingRow = {
  role: string;
  label: string;
  hint: string;
  min: number;
  per: number | null;
  orders: string; // which orders count, in words ("eat-in orders"); "" = none
  suggested: { min: number; per: number | null } | null; // for their size
  learned: { min: number; per: number | null; estimate: boolean } | null; // from their rotas
  edges: string | null; // "Starts 30 minutes before opening"
};
export type StaffingCard = {
  rows: StaffingRow[];
  notes: string[];
  source: "learned" | "suggested" | "mixed";
};

const edgeWords = (before: number, after: number) => {
  const parts = [before ? `starts ${before} minutes before opening` : null, after ? `stays ${after} minutes after closing` : null].filter(Boolean) as string[];
  if (!parts.length) return null;
  const s = parts.join(" and ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// The rows: one per role on the team. Prefilled from their own rotas where there
// was enough to learn from, else from the suggestion for their size.
export function staffingCard(input: { suggestion: Suggestion; learned: Learned | null; saved?: RotaRule[] }): StaffingCard {
  const learnedBy = new Map((input.learned?.roles ?? []).filter((r) => r.enough).map((r) => [r.role, r]));
  let fromLearned = 0;
  const rows = input.suggestion.rules.map((s): StaffingRow => {
    const l: LearnedRole | undefined = learnedBy.get(s.role);
    const saved = input.saved?.find((x) => roleKey(x.role) === s.role && x.preset === "owner");
    const use =
      saved ??
      (l
        ? {
            min_on_shift: l.min_on_shift,
            orders_per_extra_staff: l.orders_per_extra_staff ?? s.orders_per_extra_staff,
          }
        : s);
    if (l && !saved) fromLearned++;
    const driver = (s.driver ?? "all") as Driver;
    const before = l?.before_open_minutes ?? s.before_open_minutes ?? 0;
    const after = l?.after_close_minutes ?? s.after_close_minutes ?? 0;
    return {
      role: s.role,
      label: roleLabel(s.role),
      hint: (ROLE_DEFS as Record<string, { hint: string }>)[s.role]?.hint ?? "",
      min: use.min_on_shift,
      per: driver === "none" ? null : use.orders_per_extra_staff,
      orders: DRIVER_WORDS[driver],
      suggested: { min: s.min_on_shift, per: s.orders_per_extra_staff },
      learned: l
        ? {
            min: l.min_on_shift,
            per: l.orders_per_extra_staff,
            estimate: l.basis === "daily",
          }
        : null,
      edges: edgeWords(before, after),
    };
  });
  const source = fromLearned === 0 ? "suggested" : fromLearned === rows.length ? "learned" : "mixed";
  return { rows, notes: input.suggestion.notes, source };
}

// What code says above the card.
export function staffingText(card: StaffingCard, band: keyof typeof SEAT_WORDS, weeks: number | null) {
  const from =
    card.source === "learned"
      ? `I've filled this in from your last ${weeks ?? 2} weeks of rotas`
      : card.source === "mixed"
        ? `I've filled this in from your rotas where I could, and from what restaurants with ${SEAT_WORDS[band]} usually need for the rest`
        : `I've filled this in with what restaurants with ${SEAT_WORDS[band]} usually need`;
  return `How many people do you need on shift? ${from}. Change anything that's not right for you, then confirm. I'll use it for every rota I suggest.`;
}

// One row as a line ("Chef: at least 2, plus 1 more per 15 orders an hour").
export function staffingLine(r: Pick<StaffingRow, "label" | "min" | "per" | "orders">) {
  if (!r.per || !r.orders) return `${r.label}: ${r.min ? `at least ${r.min} whenever open` : "only when you put them on"}`;
  return r.min ? `${r.label}: at least ${r.min}, plus 1 more per ${r.per} ${r.orders} an hour` : `${r.label}: 1 per ${r.per} ${r.orders} an hour when busy`;
}

// The card's rows as the rules to save, with the owner's numbers.
export function rulesFromCard(
  card: StaffingCard,
  answer: Record<string, { min: number; per: number | null }> | null,
  learned: Learned | null,
  suggestion: Suggestion,
): { rules: RotaRule[]; problems: string[] } {
  const problems: string[] = [];
  const rules = card.rows.map((row) => {
    const a = answer?.[row.role];
    const min = a ? a.min : row.min;
    const per = a ? a.per : row.per;
    if (!Number.isInteger(min) || min < 0 || min > 20) problems.push(`${row.label}: at least ${min} doesn't look right (0 to 20).`);
    if (per !== null && (!Number.isFinite(per) || per < 1 || per > 200)) problems.push(`${row.label}: 1 more per ${per} orders doesn't look right.`);
    const l = learned?.roles.find((x) => x.role === row.role && x.enough);
    const s = suggestion.rules.find((x) => x.role === row.role)!;
    const shape = ROLE_SHAPE[row.role];
    const changed = a && (a.min !== row.min || a.per !== row.per);
    return {
      role: row.role,
      min_on_shift: min,
      orders_per_extra_staff: per,
      driver: s.driver ?? shape?.driver ?? "all",
      before_open_minutes: l?.before_open_minutes ?? s.before_open_minutes ?? 0,
      after_close_minutes: l?.after_close_minutes ?? s.after_close_minutes ?? 0,
      preset: changed ? "owner" : l ? "learned" : (s.preset ?? "owner"),
    } satisfies RotaRule;
  });
  return { rules, problems };
}

// ---------- A typed change ----------

const NUMBER_WORDS: Record<string, number> = {
  no: 0,
  none: 0,
  zero: 0,
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : (NUMBER_WORDS[w] ?? null));

// Plain-code reading of the common changes, in any order, several at once:
//   "2 chefs", "chefs 2", "at least 3 servers", "no host", "one porter"
//   "1 more server per 10", "+1 chef per 12 orders", "servers per 10"
//   "porter only when busy" (no minimum, keeps the busy rule)
// Returns the changes it understood and the pieces it couldn't (for Claude).
export function parseStaffingWords(text: string, rows: Pick<StaffingRow, "role" | "label" | "min" | "per">[]) {
  const out: Record<string, { min: number; per: number | null }> = {};
  const unread: string[] = [];
  const findRole = (words: string) => {
    const w = words.trim().replace(/s$/, "");
    for (const cand of [words.trim(), w, `${w}s`]) {
      if (!isRoleWord(cand)) continue;
      const k = roleKey(cand);
      const row = rows.find((r) => r.role === k || (k === "head_chef" && r.role === "chef") || (k === "kitchen" && r.role === "chef") || (k === "front" && r.role === "server"));
      if (row) return row;
    }
    return rows.find((r) => r.label.toLowerCase() === words.trim().toLowerCase()) ?? null;
  };
  const pieces = text
    .toLowerCase()
    .replace(/[.!]/g, "")
    .split(/,|;|\band\b|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const piece of pieces) {
    const base = (role: string) =>
      out[role] ?? {
        min: rows.find((r) => r.role === role)!.min,
        per: rows.find((r) => r.role === role)!.per,
      };
    // "+1 chef per 12 (orders)", "1 more server per 10", "chefs per 12", "one extra porter every 30 orders"
    let m = piece.match(/^(?:\+?\s*(?:1|one|an?)\s+(?:more|extra)?\s*)?([a-z ]+?)\s+(?:per|every|for every)\s+(\d+)(?:\s+[a-z -]*orders?)?(?:\s+an hour)?$/);
    if (m && findRole(m[1])) {
      const row = findRole(m[1])!;
      out[row.role] = { ...base(row.role), per: Number(m[2]) };
      continue;
    }
    // "porter only when busy"
    m = piece.match(/^(?:an? |the )?([a-z ]+?)\s+only when (?:it'?s )?busy$/);
    if (m && findRole(m[1])) {
      const row = findRole(m[1])!;
      out[row.role] = { ...base(row.role), min: 0 };
      continue;
    }
    // "2 chefs", "at least 3 servers", "no host", "always 1 manager"
    m = piece.match(
      /^(?:at least |always |minimum (?:of )?|min )?(\d+|no|none|zero|one|a|an|two|three|four|five|six|seven|eight|nine|ten)\s+([a-z ]+?)(?:\s+(?:on|at all times|whenever open|on every shift|every shift|minimum))*$/,
    );
    if (m && num(m[1]) !== null && findRole(m[2])) {
      const row = findRole(m[2])!;
      out[row.role] = { ...base(row.role), min: num(m[1])! };
      continue;
    }
    // "chefs 2", "servers: 3"
    m = piece.match(/^([a-z ]+?)\s*:?\s+(\d+)$/);
    if (m && findRole(m[1])) {
      const row = findRole(m[1])!;
      out[row.role] = { ...base(row.role), min: Number(m[2]) };
      continue;
    }
    if (!/^(looks? (right|good|fine)|that'?s (right|fine)|ok(ay)?|yes|fine)$/.test(piece)) unread.push(piece);
  }
  return { changes: out, unread };
}
