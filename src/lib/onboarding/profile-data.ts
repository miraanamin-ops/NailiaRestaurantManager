// Plain-code helpers for a restaurant's profile: opening hours and the menu.
// Used by onboarding, by the settings page and by "change Friday hours to 11pm"
// messages. No imports, so it's unit-tested.

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type Day = (typeof DAYS)[number];
export type Hours = Partial<Record<Day, string>>; // "12:00 – 23:00" or "Closed"

export const UK_ALLERGENS = [
  "celery", "cereals containing gluten", "crustaceans", "eggs", "fish", "lupin", "milk",
  "molluscs", "mustard", "tree nuts", "peanuts", "sesame", "soya", "sulphites",
] as const;

export type MenuItem = {
  name: string;
  price: number;
  description: string | null;
  allergens?: string[];
  // Allergens are only ever shown to customers (or used in their messages) once confirmed.
  allergens_confirmed?: boolean;
};
export type MenuCategory = { category: string; items: MenuItem[] };

// "9:00 AM" / "11:30 PM" / "12:00" -> "09:00" / "23:30" / "12:00"
export function to24h(t: string) {
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ?? "00";
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 24 || Number(min) > 59) return null;
  return `${String(h % 24).padStart(2, "0")}:${min}`;
}

// Google's "Monday: 9:00 AM – 5:00 PM" lines -> { Monday: "09:00 – 17:00" }.
export function hoursFromGoogle(weekdayDescriptions: string[]): Hours {
  const out: Hours = {};
  for (const line of weekdayDescriptions) {
    const [dayRaw, ...rest] = line.split(":");
    const day = DAYS.find((d) => d.toLowerCase() === dayRaw.trim().toLowerCase());
    if (!day) continue;
    const value = rest.join(":").replace(/ | /g, " ").trim();
    if (/closed/i.test(value)) out[day] = "Closed";
    else if (/open 24 hours/i.test(value)) out[day] = "00:00 – 24:00";
    else {
      const ranges = value.split(",").map((range) => {
        const [a, b] = range.split(/\s*[–-]\s*/);
        // "9:00 – 5:00 PM": the first time takes the second's AM/PM if it has none.
        const suffix = b?.match(/[AaPp][Mm]/)?.[0] ?? "";
        const open = to24h(/[AaPp][Mm]/.test(a ?? "") ? a : `${a} ${suffix}`.trim());
        const close = to24h(b ?? "");
        return open && close ? `${open} – ${close}` : null;
      });
      if (ranges.every(Boolean)) out[day] = ranges.join(", ");
    }
  }
  return out;
}

export function setDayHours(hours: Hours, day: Day, value: { open: string; close: string } | "Closed"): Hours {
  return { ...hours, [day]: value === "Closed" ? "Closed" : `${value.open} – ${value.close}` };
}

export function dayFrom(text: string): Day | null {
  const t = text.trim().toLowerCase();
  return DAYS.find((d) => d.toLowerCase() === t || d.toLowerCase().slice(0, 3) === t.slice(0, 3)) ?? null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function findItem(menu: MenuCategory[], name: string) {
  for (const c of menu) for (const i of c.items) if (sameName(i.name, name)) return { category: c, item: i };
  return null;
}

// Adds a dish (or updates its price if it's already there). New dishes go in the
// named category, or the first one, or a new "Menu" category.
export function addOrUpdateItem(menu: MenuCategory[], item: { name: string; price: number; description?: string | null; category?: string | null }): MenuCategory[] {
  const copy = menu.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i })) }));
  const existing = findItem(copy, item.name);
  if (existing) {
    existing.item.price = item.price;
    if (item.description !== undefined) existing.item.description = item.description;
    return copy;
  }
  const wanted = item.category ? copy.find((c) => sameName(c.category, item.category!)) : copy[0];
  const target = wanted ?? { category: item.category || "Menu", items: [] };
  if (!wanted) copy.push(target);
  // A new dish's allergens are unknown until the owner confirms them.
  target.items.push({ name: item.name.trim(), price: item.price, description: item.description ?? null, allergens: [], allergens_confirmed: false });
  return copy;
}

export function removeItem(menu: MenuCategory[], name: string): MenuCategory[] {
  return menu.map((c) => ({ ...c, items: c.items.filter((i) => !sameName(i.name, name)) })).filter((c) => c.items.length);
}

export function menuItemCount(menu: MenuCategory[]) {
  return menu.reduce((n, c) => n + c.items.length, 0);
}

// What customers (and Claude, when writing for customers) may see: allergens
// only when the owner has confirmed them.
export function customerSafeMenu(menu: MenuCategory[]): MenuCategory[] {
  return menu.map((c) => ({
    category: c.category,
    items: c.items.map(({ allergens, allergens_confirmed, ...rest }) => (allergens_confirmed && allergens?.length ? { ...rest, allergens } : rest)),
  }));
}

// "£14", "14.5", "£7.95" -> 14 / 14.5 / 7.95
export function parsePrice(text: string) {
  const m = text.replace(/,/g, "").match(/£?\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Math.round(Number(m[1]) * 100) / 100 : null;
}

export function formatPrice(p: number) {
  return `£${p.toFixed(2)}`;
}
