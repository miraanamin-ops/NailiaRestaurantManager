// The app's settings (step 50, phase 5), as plain code (tests/app-more.test.ts):
// what the More > Settings screen shows, and how a change the owner made there is
// checked before it's saved through the website's own saveProfileFields (so UNDO
// and the activity log work exactly as on the website and WhatsApp).
import { DAYS, parseHoursText, type Hours } from "@/lib/onboarding/profile-data";

// Which notifications the owner wants on their phone (068 restaurants.app_alerts).
// A kind switched off never buzzes: the item still waits in the app (Inbox, Chat).
export const ALERT_KINDS = ["brief", "urgent", "updates", "reports", "nudge"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export type AlertPrefs = Record<AlertKind, boolean>;
export const ALERT_LABELS: Record<AlertKind, { title: string; detail: string }> = {
  brief: { title: "Morning brief", detail: "Once a day, at your brief time" },
  urgent: { title: "Urgent alerts", detail: "1 to 3 star reviews and unhappy customers, straight away" },
  updates: { title: "Updates", detail: "The rota, things you asked for, and other news" },
  reports: { title: "Reports", detail: "Your weekly and monthly reports" },
  nudge: { title: "Reminders", detail: "A nudge if you haven't opened the app in a few days" },
};

export function alertPrefs(saved: unknown): AlertPrefs {
  const s = (saved && typeof saved === "object" ? saved : {}) as Partial<Record<string, unknown>>;
  return Object.fromEntries(ALERT_KINDS.map((k) => [k, s[k] !== false])) as AlertPrefs;
}

// The kind of notification a message is (lib/openers.ts requests, plus the brief).
export function alertKindOf(request: string): AlertKind {
  if (request === "brief") return "brief";
  if (request === "alert" || request === "review" || request === "feedback") return "urgent";
  if (request === "report") return "reports";
  if (request === "nudge") return "nudge";
  return "updates";
}

export type SettingsRow = {
  opening_hours?: Hours | null;
  signup_reward?: string | null;
  discount_cap_percent?: number | null;
  send_window_start?: string | null;
  send_window_end?: string | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  brief_hour?: number | null;
  sign_off_name?: string | null;
  greeting?: string | null;
  words_to_avoid?: string[] | null;
  emoji_allowed?: { review_replies?: number; posts?: number; campaigns?: number } | null;
  paused?: boolean | null;
  app_alerts?: unknown;
};

const hhmm = (t: string | null | undefined, fallback: string) => (t ?? fallback).slice(0, 5);

// What the settings screen shows.
export function settingsView(r: SettingsRow) {
  return {
    hours: DAYS.map((day) => ({ day, value: r.opening_hours?.[day] ?? "" })),
    signupReward: r.signup_reward ?? "",
    discountCap: r.discount_cap_percent ?? 0,
    sendWindow: { start: hhmm(r.send_window_start, "09:00"), end: hhmm(r.send_window_end, "21:00") },
    quietHours: { start: hhmm(r.quiet_hours_start, "23:00"), end: hhmm(r.quiet_hours_end, "09:00") },
    briefHour: r.brief_hour ?? 9,
    voice: {
      signOffName: r.sign_off_name ?? "",
      greeting: r.greeting ?? "",
      wordsToAvoid: (r.words_to_avoid ?? []).join(", "),
      emoji: { reviewReplies: r.emoji_allowed?.review_replies ?? 0, posts: r.emoji_allowed?.posts ?? 0, campaigns: r.emoji_allowed?.campaigns ?? 0 },
    },
    paused: Boolean(r.paused),
    alerts: alertPrefs(r.app_alerts),
  };
}
export type SettingsView = ReturnType<typeof settingsView>;

// A change from the app: only what's sent is changed. One section at a time.
export type SettingsInput = Partial<{
  hours: { day: string; value: string }[];
  signupReward: string;
  discountCap: number;
  sendWindow: { start: string; end: string };
  quietHours: { start: string; end: string };
  briefHour: number;
  voice: { signOffName?: string; greeting?: string; wordsToAvoid?: string; emoji?: { reviewReplies?: number; posts?: number; campaigns?: number } };
  alerts: Partial<Record<string, boolean>>;
}>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const emojis = (n: unknown) => Math.min(5, Math.max(0, Math.round(Number(n) || 0)));

// fields: what saveProfileFields saves; alerts: the notification choices (not a profile
// field: saved on their own); problem: the owner's words for what's wrong (nothing saved).
export function settingsChanges(input: SettingsInput, r: SettingsRow): { fields: Record<string, unknown>; alerts: AlertPrefs | null; problem: string | null } {
  const fields: Record<string, unknown> = {};
  const fail = (problem: string) => ({ fields: {}, alerts: null, problem });

  if (input.hours) {
    const hours: Hours = { ...(r.opening_hours ?? {}) };
    const unclear: string[] = [];
    for (const { day, value } of input.hours) {
      if (!(DAYS as readonly string[]).includes(day)) continue;
      const typed = value.trim();
      if (!typed) {
        delete hours[day as (typeof DAYS)[number]];
        continue;
      }
      const parsed = parseHoursText(typed);
      if (parsed) hours[day as (typeof DAYS)[number]] = parsed;
      else unclear.push(day);
    }
    if (unclear.length) return fail(`Couldn't read the hours for ${unclear.join(", ")}. Try e.g. 12:00 – 22:00, or Closed.`);
    fields.opening_hours = hours;
  }
  if (input.signupReward !== undefined) {
    const reward = input.signupReward.trim().slice(0, 100);
    fields.signup_reward = reward || null;
  }
  if (input.discountCap !== undefined) {
    const cap = Number(input.discountCap);
    if (!(cap >= 0 && cap <= 100)) return fail("The discount cap needs to be between 0 and 100.");
    fields.discount_cap_percent = Math.round(cap);
  }
  if (input.sendWindow) {
    const { start, end } = input.sendWindow;
    if (!TIME.test(start) || !TIME.test(end)) return fail("Sending hours need a start and an end time, e.g. 09:00 and 21:00.");
    if (toMinutes(start) < 7 * 60 || toMinutes(end) > 22 * 60) return fail("Sending hours can be between 7am and 10pm.");
    if (toMinutes(end) - toMinutes(start) < 4 * 60) return fail("Sending hours need to be at least 4 hours long.");
    if (hhmm(r.send_window_start, "") !== start) fields.send_window_start = start;
    if (hhmm(r.send_window_end, "") !== end) fields.send_window_end = end;
  }
  if (input.quietHours) {
    const { start, end } = input.quietHours;
    if (!TIME.test(start) || !TIME.test(end)) return fail("Quiet hours need a start and an end time, e.g. 23:00 and 09:00.");
    if (start === end) return fail("Quiet hours need to start and end at different times.");
    if (hhmm(r.quiet_hours_start, "") !== start) fields.quiet_hours_start = start;
    if (hhmm(r.quiet_hours_end, "") !== end) fields.quiet_hours_end = end;
  }
  if (input.briefHour !== undefined) {
    const h = Math.round(Number(input.briefHour));
    if (!(h >= 7 && h <= 11)) return fail("Your brief can come between 7am and 11am.");
    fields.brief_hour = h;
  }
  if (input.voice) {
    const v = input.voice;
    if (v.signOffName !== undefined) fields.sign_off_name = v.signOffName.trim().slice(0, 60) || null;
    if (v.greeting !== undefined) fields.greeting = v.greeting.trim().slice(0, 40) || null;
    if (v.wordsToAvoid !== undefined)
      fields.words_to_avoid = v.wordsToAvoid
        .split(/\n|,/)
        .map((w) => w.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 20);
    if (v.emoji) {
      const now = r.emoji_allowed ?? {};
      fields.emoji_allowed = {
        review_replies: v.emoji.reviewReplies === undefined ? (now.review_replies ?? 0) : emojis(v.emoji.reviewReplies),
        posts: v.emoji.posts === undefined ? (now.posts ?? 0) : emojis(v.emoji.posts),
        campaigns: v.emoji.campaigns === undefined ? (now.campaigns ?? 0) : emojis(v.emoji.campaigns),
      };
    }
  }
  const alerts = input.alerts ? { ...alertPrefs(r.app_alerts), ...Object.fromEntries(Object.entries(input.alerts).filter(([k, v]) => (ALERT_KINDS as readonly string[]).includes(k) && typeof v === "boolean")) } : null;
  return { fields, alerts: alerts as AlertPrefs | null, problem: null };
}
