// What the team sees on the published rota (/rota/<token>) and its PDF: who
// works when. Never pay, costs, labour % or the owner's flags: the link is for
// forwarding to staff. Pure (type imports only): unit-tested (tests/rota-fill.test.ts).
import type { RotaPlan } from "./fill";
import { roleLabel } from "./rules";
import { span12, time12 } from "./rules";

// One person in one hour of the grid: "Priya", or "Priya from 11:30" when they
// only work part of that hour. open = a shift nobody fills yet.
export type HourName = { text: string; open?: boolean };
export type HourGroup = { key: string; label: string; names: HourName[] };

export type RotaView = {
  title: string; // "Test Kitchen"
  week: string; // "Mon 2 – Sun 8 Nov"
  days: { date: string; label: string; open: string; shifts: { time: string; name: string; role: string }[] }[];
  people: { name: string; cells: string[]; hours: number }[]; // cells: one per day, "12pm–5:30pm" or ""
  openShifts: number;
  dayHeads: string[]; // "Mon 2"
  // The week hour by hour (the PDF's second table): one row per hour from the
  // first shift's start to the last one's end, one cell per day, kitchen first.
  hours: { label: string; cells: HourGroup[][] }[]; // label "11am"
  groups: { key: string; label: string }[]; // the groups that appear, for the key
  closed: boolean[]; // per day
};

// Kitchen, then front of house (managers included), then any other role.
const groupOf = (role: string) =>
  role === "kitchen" ? { key: "kitchen", label: "Kitchen" } : role === "front" || role === "manager" ? { key: "front", label: "Front of house" } : { key: role, label: roleLabel(role) };
const groupRank = (key: string) => (key === "kitchen" ? 0 : key === "front" ? 1 : 2);

function hourGrid(plan: Pick<RotaPlan, "days">) {
  const all = plan.days.flatMap((d) => d.shifts);
  if (!all.length) return { hours: [], groups: [] };
  const first = Math.floor(Math.min(...all.map((s) => s.start)) / 60);
  const last = Math.ceil(Math.max(...all.map((s) => s.end)) / 60);
  const seen = new Map<string, string>();
  const hours = [];
  for (let h = first; h < last; h++) {
    const from = h * 60;
    const to = from + 60;
    const cells = plan.days.map((d) => {
      const groups = new Map<string, HourGroup>();
      // named people first, then open shifts; each by start time
      const shifts = d.shifts.filter((s) => s.start < to && s.end > from).sort((a, b) => Number(!a.name) - Number(!b.name) || a.start - b.start);
      for (const s of shifts) {
        const g = groupOf(s.role);
        seen.set(g.key, g.label);
        const group = groups.get(g.key) ?? { ...g, names: [] };
        const who = s.name ?? "Open shift";
        // the row already says am or pm: "Priya from 11:30"
        const at = (m: number) => time12(m).replace(/[ap]m$/, "");
        const text = s.start > from ? `${who} from ${at(s.start)}` : s.end < to ? `${who} until ${at(s.end)}` : who;
        group.names.push(s.name ? { text } : { text, open: true });
        groups.set(g.key, group);
      }
      return [...groups.values()].sort((a, b) => groupRank(a.key) - groupRank(b.key));
    });
    hours.push({ label: time12(from), cells });
  }
  const groups = [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => groupRank(a.key) - groupRank(b.key));
  return { hours, groups };
}

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const dateWords = (ymd: string, weekday: number, long = true) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  const day = d.getUTCDate();
  const month = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return long ? `${DAY_NAMES[weekday]} ${day} ${month}` : `${DAY_NAMES[weekday].slice(0, 3)} ${day}`;
};

export function rotaView(plan: Pick<RotaPlan, "days">, names: { restaurant: string; week: string }): RotaView {
  const people = new Map<string, { name: string; cells: string[]; minutes: number }>();
  let openShifts = 0;
  const days = plan.days.map((d, i) => {
    for (const s of d.shifts) {
      if (!s.staffId || !s.name) {
        openShifts++;
        continue;
      }
      const p = people.get(s.staffId) ?? { name: s.name, cells: plan.days.map(() => ""), minutes: 0 };
      p.cells[i] = p.cells[i] ? `${p.cells[i]}, ${span12(s.start, s.end)}` : span12(s.start, s.end);
      p.minutes += s.end - s.start;
      people.set(s.staffId, p);
    }
    return {
      date: d.date,
      label: dateWords(d.date, d.weekday),
      open: d.open.length ? d.open.map((o) => span12(o.start, o.end)).join(", ") : "Closed",
      shifts: d.shifts.map((s) => ({ time: span12(s.start, s.end), name: s.name ?? "Open shift (not filled yet)", role: roleLabel(s.role) })),
    };
  });
  return {
    title: names.restaurant,
    week: names.week,
    days,
    people: [...people.values()].map((p) => ({ name: p.name, cells: p.cells, hours: Math.round(p.minutes / 6) / 10 })).sort((a, b) => a.name.localeCompare(b.name)),
    openShifts,
    dayHeads: plan.days.map((d) => dateWords(d.date, d.weekday, false)),
    ...hourGrid(plan),
    closed: plan.days.map((d) => !d.open.length),
  };
}
