// What an Inbox card shows of the thing itself (phase 2 of the Inbox and emails plan,
// 15 Nov 2026: "the user should just be able to see the rota directly"): the rota week,
// the real email, the Google post as Google shows it, or an hours or menu change as
// before and after. The app draws each one, small on the open card and full screen on a
// tap, so the owner never copies a link out of the app. Plain code (tests/app-card-views.test.ts).
import type { AppRotaWeek } from "./rota-rules";

export type ChangeRow = { label: string; from: string; to: string };

export type CardView =
  | { type: "rota"; week: AppRotaWeek }
  | { type: "email"; subject: string | null; html: string }
  | { type: "google_post"; name: string; text: string; photoUrl: string | null }
  | { type: "change"; field: "hours" | "menu"; note: string; rows: ChangeRow[] };

// An hours or menu update's words (agents/visibility.ts updateText):
//   "<note>\n\nOn Google now: Fri: 12pm to 11pm; Sat: ...\nAfter you approve: Fri: 12pm to 10pm; Sat: ..."
// as rows of label, before and after. Null when the words aren't in that shape.
export function changeView(kind: "hours_update" | "menu_update", content: string): Extract<CardView, { type: "change" }> | null {
  const now = content.match(/^On Google now:\s*(.*)$/m);
  const after = content.match(/^After you approve:\s*(.*)$/m);
  if (!now || !after) return null;
  const split = (s: string) =>
    s
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
  const before = split(now[1]);
  const later = split(after[1]);
  const labelOf = (s: string) => (s.includes(":") ? s.slice(0, s.indexOf(":")).trim() : "");
  const valueOf = (s: string) => (s.includes(":") ? s.slice(s.indexOf(":") + 1).trim() : s);
  const rows: ChangeRow[] = later.map((to, i) => {
    const label = labelOf(to) || labelOf(before[i] ?? "");
    const from = before.find((b) => labelOf(b) === label) ?? before[i] ?? "";
    return { label, from: valueOf(from) || "not set", to: valueOf(to) };
  });
  if (!rows.length) return null;
  const note = content.slice(0, now.index).trim();
  return { type: "change", field: kind === "menu_update" ? "menu" : "hours", note, rows };
}
