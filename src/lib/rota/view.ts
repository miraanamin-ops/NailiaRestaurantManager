// What the team sees on the published rota (/rota/<token>) and its PDF: who
// works when. Never pay, costs, labour % or the owner's flags: the link is for
// forwarding to staff. Pure (type imports only): unit-tested (tests/rota-fill.test.ts).
import type { RotaPlan } from "./fill";
import { roleLabel, shortSpan, clockText } from "./rules";

export type RotaView = {
  title: string; // "Test Kitchen"
  week: string; // "Mon 2 – Sun 8 Nov"
  days: { date: string; label: string; open: string; shifts: { time: string; name: string; role: string }[] }[];
  people: { name: string; cells: string[]; hours: number }[]; // cells: one per day, "12–22" or ""
  openShifts: number;
  dayHeads: string[]; // "Mon 2"
};

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
      p.cells[i] = p.cells[i] ? `${p.cells[i]}, ${shortSpan(s.start, s.end)}` : shortSpan(s.start, s.end);
      p.minutes += s.end - s.start;
      people.set(s.staffId, p);
    }
    return {
      date: d.date,
      label: dateWords(d.date, d.weekday),
      open: d.open.length ? d.open.map((o) => `${clockText(o.start)}–${clockText(o.end)}`).join(", ") : "Closed",
      shifts: d.shifts.map((s) => ({ time: `${clockText(s.start)}–${clockText(s.end)}`, name: s.name ?? "Open shift (not filled yet)", role: roleLabel(s.role) })),
    };
  });
  return {
    title: names.restaurant,
    week: names.week,
    days,
    people: [...people.values()].map((p) => ({ name: p.name, cells: p.cells, hours: Math.round(p.minutes / 6) / 10 })).sort((a, b) => a.name.localeCompare(b.name)),
    openShifts,
    dayHeads: plan.days.map((d) => dateWords(d.date, d.weekday, false)),
  };
}
