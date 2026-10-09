// UK time helpers. Plain code, no libraries: all rules work in London time,
// which switches between GMT and BST automatically.
const TZ = "Europe/London";

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

export function londonParts(d: Date) {
  const p: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(d)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

// How far London is ahead of UTC at this instant (0 in winter, 1h in summer).
function londonOffsetMs(d: Date) {
  const p = londonParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

// The instant when London's clock shows this date and time.
export function londonTime(year: number, month: number, day: number, hour: number, minute: number) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wallClock;
  for (let i = 0; i < 2; i++) guess = wallClock - londonOffsetMs(new Date(guess));
  return new Date(guess);
}

// "09:00" or "09:00:00" -> minutes after midnight.
export function minutesOf(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function londonMinutes(d: Date) {
  const p = londonParts(d);
  return p.hour * 60 + p.minute;
}

// Sending is allowed from the window start up to (not including) the end.
export function isInSendWindow(now: Date, start: string, end: string) {
  const m = londonMinutes(now);
  return m >= minutesOf(start) && m < minutesOf(end);
}

// The next time the send window opens, strictly after `now` unless we're before today's opening.
export function nextWindowStart(now: Date, start: string) {
  const p = londonParts(now);
  const startMin = minutesOf(start);
  const dayOffset = londonMinutes(now) < startMin ? 0 : 1;
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  return londonTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(startMin / 60), startMin % 60);
}

// "HH:MM" today (or tomorrow) in London, for the TIME test command.
export function londonTimeOn(now: Date, hhmm: string, plusDays: number) {
  const p = londonParts(now);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day + plusDays));
  const [h, m] = hhmm.split(":").map(Number);
  return londonTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m);
}

export function formatLondon(d: Date) {
  return d.toLocaleString("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatWindow(start: string, end: string) {
  const fmt = (t: string) => {
    const mins = minutesOf(t);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}
