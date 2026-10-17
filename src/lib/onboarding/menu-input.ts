import { z } from "zod";
import { UK_ALLERGENS, type MenuCategory } from "./profile-data";

// A menu sent from the browser (the wizard or the settings page), checked before
// it's saved. Allergens come back unconfirmed unless `keepConfirmedFrom` (the
// saved menu) already had the same allergens confirmed for that dish (found by
// its id when the settings page sent one, else by name). Ids (settings page only)
// are kept so saveMenu keeps the same dish, even when it's renamed.

const Id = z.string().uuid().optional();

const MenuInput = z
  .array(
    z.object({
      id: Id,
      category: z.string().trim().max(60),
      items: z
        .array(
          z.object({
            id: Id,
            name: z.string().trim().max(100),
            price: z.number().min(0).max(1000),
            description: z.string().trim().max(300).nullable().optional(),
            allergens: z.array(z.enum(UK_ALLERGENS)).optional(),
          }),
        )
        .max(200),
    }),
  )
  .max(40);

export function cleanMenu(menu: unknown, keepConfirmedFrom: MenuCategory[] = []): MenuCategory[] {
  const savedItems = keepConfirmedFrom.flatMap((c) => c.items);
  const byId = new Map(savedItems.filter((i) => i.id).map((i) => [i.id, i]));
  const byName = new Map(savedItems.map((i) => [i.name.trim().toLowerCase(), i]));
  const same = (a: string[] = [], b: string[] = []) => [...a].sort().join() === [...b].sort().join();
  return MenuInput.parse(menu)
    .map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      category: c.category || "Menu",
      items: c.items
        .filter((i) => i.name)
        .map((i) => {
          const before = (i.id ? byId.get(i.id) : undefined) ?? byName.get(i.name.toLowerCase());
          const allergens = i.allergens ?? before?.allergens ?? [];
          return {
            ...(i.id ? { id: i.id } : {}),
            name: i.name,
            price: Math.round(i.price * 100) / 100,
            description: i.description || null,
            allergens,
            allergens_confirmed: Boolean(before?.allergens_confirmed && same(before.allergens, allergens)),
          };
        }),
    }))
    .filter((c) => c.items.length);
}
