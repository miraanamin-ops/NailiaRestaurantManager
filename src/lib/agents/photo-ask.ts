// Once a week (Tuesday's morning brief) the GM asks the owner for one photo of
// one dish, for Thursday's Google post (4 Nov: Visibility no longer needs photos
// to go live, so the library grows a photo at a time instead). The dish rotates
// week by week, favouring dishes the library has no photo of yet, and the
// dishes the menu's numbers say to push (menu engineering), when there are any.
// Plain code (only menu engineering's plain rules), so it's unit-tested (tests/photo-ask.test.ts).
import { dishesToPush, menuProfit } from "@/lib/menu-engineering";
import type { BriefSectionDef } from "@/lib/sections/types";

export const PHOTO_ASK_WEEKDAY = 2; // Tuesday (0 = Sunday), two days before Thursday's post

type Menu = { category?: string; items?: { name?: string }[] }[] | null | undefined;
type Library = { caption?: string | null }[] | null | undefined;

// Not worth a post on their own.
const SKIP = /drink|beverage|soft|juice|lassi|tea|coffee|sauce|dip|extra|side|add[- ]?on/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Weeks since 5 Jan 2026 (a Monday), in London's calendar: the rotation's counter.
function weekNumber(ymd: string) {
  return Math.floor((Date.parse(`${ymd}T12:00:00Z`) - Date.parse("2026-01-05T12:00:00Z")) / (7 * 86_400_000));
}

// The dish to ask for this week, or null (no menu worth asking about).
// prefer: dishes to push first (menu engineering's high-profit ones), by name.
export function photoAskDish(input: { menu: Menu; library: Library; today: string; prefer?: string[] }): string | null {
  const dishes = (input.menu ?? [])
    .filter((c) => !SKIP.test(c.category ?? ""))
    .flatMap((c) => (c.items ?? []).map((i) => i.name?.trim()).filter((n): n is string => Boolean(n)));
  if (!dishes.length) return null;
  const captions = (input.library ?? []).map((p) => norm(p.caption ?? "")).join(" | ");
  const withoutPhoto = dishes.filter((d) => !captions.includes(norm(d)));
  const preferred = (input.prefer ?? []).map((p) => dishes.find((d) => norm(d) === norm(p))).filter((d): d is string => Boolean(d));
  const pool = preferred.filter((d) => withoutPhoto.includes(d)).length ? preferred.filter((d) => withoutPhoto.includes(d)) : withoutPhoto.length ? withoutPhoto : dishes;
  const n = weekNumber(input.today);
  return pool[((n % pool.length) + pool.length) % pool.length];
}

export function photoAskLine(dish: string) {
  return `📸 *Photo for Thursday's Google post:* could you send me a photo of your ${dish}? Just reply here with it and I'll write the post around it.`;
}

// The London date and weekday for a moment.
function london(now: Date) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
  return { ymd, weekday: new Date(`${ymd}T12:00:00Z`).getUTCDay() };
}

// The brief's block: Tuesdays only, for restaurants with a menu.
export const photoAskBriefSection: BriefSectionDef = {
  id: "photo_ask",
  order: 8,
  async block({ restaurant, now }) {
    const { ymd, weekday } = london(now);
    if (weekday !== PHOTO_ASK_WEEKDAY) return null;
    const r = restaurant as unknown as { menu?: Menu; photo_library?: Library };
    // The high-profit dishes first, once the owner has given dish costs.
    const prefer = dishesToPush(menuProfit(r.menu as Parameters<typeof menuProfit>[0]));
    const dish = photoAskDish({ menu: r.menu, library: r.photo_library, today: ymd, prefer });
    return dish ? photoAskLine(dish) : null;
  },
};
