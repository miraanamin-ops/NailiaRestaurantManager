// Menu ids are only for the settings page's editors (so an edit keeps the same
// dish); restaurants.menu, the audit log and UNDO never hold them. No imports
// beyond types, so it's unit-tested.
import type { MenuCategory, MenuItem } from "@/lib/supabase";

const withoutId = <T extends { id?: string }>(row: T): Omit<T, "id"> => {
  const copy = { ...row };
  delete copy.id;
  return copy;
};

export function stripMenuIds(menu: MenuCategory[]): MenuCategory[] {
  return menu.map((c) => ({ ...withoutId(c), items: c.items.map((i) => withoutId(i) as MenuItem) }));
}
