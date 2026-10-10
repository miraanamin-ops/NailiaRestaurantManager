// "Change Friday hours to 11pm", "add lamb chops, £14": the owner's changes to
// their restaurant's details, as Claude understood them, checked and turned into
// new values. Plain code (only the plain profile helpers), so it's unit-tested.
// lib/profile-edits.ts saves them and logs each one so UNDO can put it back.
import { addOrUpdateItem, DAYS, findItem, formatPrice, removeItem, type Day, type Hours, type MenuCategory } from "./profile-data";

export type ProfileChange = {
  change: "hours" | "add_dish" | "dish_price" | "remove_dish" | "reward" | "discount_cap" | "phone" | "address" | "website";
  day?: string; // "Friday", "every day", "weekdays", "weekend"
  open?: string; // "12:00"
  close?: string; // "23:00"
  closed?: boolean;
  name?: string;
  price?: number;
  category?: string;
  value?: string;
  percent?: number;
};

export type ProfileFields = {
  opening_hours: Hours;
  menu: MenuCategory[];
  signup_reward: string | null;
  discount_cap_percent: number;
  phone: string | null;
  address: string | null;
  website: string | null;
};

const TIME = /^([01]?\d|2[0-4]):([0-5]\d)$/;
const time = (t: string | undefined) => {
  const m = t?.trim().match(TIME);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
};

function daysFrom(text: string | undefined): Day[] {
  const t = (text ?? "").trim().toLowerCase();
  if (/^(every ?day|daily|all week|all days)$/.test(t)) return [...DAYS];
  if (/^weekdays?$/.test(t)) return DAYS.slice(0, 5);
  if (/^(weekends?|sat(urday)? and sun(day)?)$/.test(t)) return DAYS.slice(5);
  const day = DAYS.find((d) => d.toLowerCase() === t || (t.length >= 3 && d.toLowerCase().startsWith(t)));
  return day ? [day] : [];
}

// "12:00 – 22:00" or "12:00 – 15:00, 18:00 – 22:00": a new opening time changes
// the first range, a new closing time the last.
function newHours(existing: string | undefined, open: string | null, close: string | null) {
  const ranges = existing && existing !== "Closed" ? existing.split(/,\s*/).map((r) => r.split(/\s*[–-]\s*/)) : [];
  if (!ranges.length) return open && close ? `${open} – ${close}` : null;
  if (open) ranges[0][0] = open;
  if (close) ranges[ranges.length - 1][1] = close;
  return ranges.map(([a, b]) => `${a} – ${b}`).join(", ");
}

export function planProfileChanges(current: ProfileFields, changes: ProfileChange[]) {
  const fields: Partial<ProfileFields> = {};
  const lines: string[] = [];
  const problems: string[] = [];
  let hours: Hours = { ...(current.opening_hours ?? {}) };
  let menu = current.menu ?? [];

  for (const c of changes) {
    switch (c.change) {
      case "hours": {
        const days = daysFrom(c.day);
        if (!days.length) {
          problems.push(`I didn't catch which day "${c.day ?? ""}" is.`);
          break;
        }
        for (const day of days) {
          if (c.closed) {
            hours = { ...hours, [day]: "Closed" };
            lines.push(`${day}: closed`);
            continue;
          }
          const value = newHours(hours[day], time(c.open), time(c.close));
          if (!value) {
            problems.push(`What time do you open and close on ${day}?`);
            continue;
          }
          hours = { ...hours, [day]: value };
          lines.push(`${day}: ${value}`);
        }
        fields.opening_hours = hours;
        break;
      }
      case "add_dish": {
        const name = c.name?.trim();
        if (!name || c.price == null || !(c.price >= 0) || c.price > 1000) {
          problems.push(`To add a dish I need its name and price, e.g. "add Lamb Chops, £14".`);
          break;
        }
        const existed = findItem(menu, name);
        menu = addOrUpdateItem(menu, { name, price: Math.round(c.price * 100) / 100, category: c.category?.trim() || null });
        lines.push(existed ? `${existed.item.name}: now ${formatPrice(c.price)}` : `Added ${name} (${formatPrice(c.price)})${c.category ? ` to ${c.category}` : ""}. Its allergens aren't confirmed yet, so customers won't be told any.`);
        fields.menu = menu;
        break;
      }
      case "dish_price": {
        const found = c.name ? findItem(menu, c.name) : null;
        if (!found || c.price == null || !(c.price >= 0) || c.price > 1000) {
          problems.push(found ? `What's the new price for ${found.item.name}?` : `I couldn't find "${c.name ?? ""}" on your menu.`);
          break;
        }
        menu = addOrUpdateItem(menu, { name: found.item.name, price: Math.round(c.price * 100) / 100 });
        lines.push(`${found.item.name}: now ${formatPrice(c.price)}`);
        fields.menu = menu;
        break;
      }
      case "remove_dish": {
        const found = c.name ? findItem(menu, c.name) : null;
        if (!found) {
          problems.push(`I couldn't find "${c.name ?? ""}" on your menu.`);
          break;
        }
        menu = removeItem(menu, found.item.name);
        lines.push(`Removed ${found.item.name}`);
        fields.menu = menu;
        break;
      }
      case "reward": {
        const v = c.value?.trim().slice(0, 100);
        if (!v) problems.push("What should the sign-up reward be?");
        else {
          fields.signup_reward = v;
          lines.push(`Sign-up reward: ${v}`);
        }
        break;
      }
      case "discount_cap": {
        const p = Math.round(c.percent ?? NaN);
        if (!(p >= 0 && p <= 100)) problems.push("The discount cap needs to be between 0% and 100%.");
        else {
          fields.discount_cap_percent = p;
          lines.push(`Discount cap: ${p}%`);
        }
        break;
      }
      case "phone":
      case "address":
      case "website": {
        const v = c.value?.trim().slice(0, 200);
        if (!v) problems.push(`What's the new ${c.change}?`);
        else if (c.change === "website" && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(v)) problems.push(`"${v}" doesn't look like a website address.`);
        else {
          fields[c.change] = c.change === "website" && !/^https?:\/\//i.test(v) ? `https://${v}` : v;
          lines.push(`${c.change[0].toUpperCase()}${c.change.slice(1)}: ${fields[c.change]}`);
        }
        break;
      }
    }
  }
  return { fields, lines, problems };
}
