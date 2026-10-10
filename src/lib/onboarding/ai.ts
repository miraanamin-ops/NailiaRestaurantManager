import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { claude, MAX_TOKENS, MODEL, WITH_FALLBACK } from "@/lib/claude";
import { UK_ALLERGENS, type MenuCategory } from "./profile-data";

// The AI parts of onboarding: reading menu photos, suggesting allergens, and
// drafting brand voices to choose from. Everything here is a suggestion the
// owner confirms; nothing is used until they do.

export type MenuImage = { base64: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };

const MenuSchema = z.object({
  categories: z.array(
    z.object({
      category: z.string().describe("Section heading as on the menu, e.g. 'Starters'"),
      items: z.array(
        z.object({
          name: z.string(),
          price: z.number().describe("Price in pounds, e.g. 7.95. Use 0 if no price is shown."),
          description: z.string().nullable().describe("Short description if the menu has one, else null"),
        }),
      ),
    }),
  ),
});

async function parse<T extends z.ZodType>(schema: T, system: string, content: Parameters<ReturnType<typeof claude>["beta"]["messages"]["parse"]>[0]["messages"][number]["content"], effort: "low" | "medium" = "medium") {
  const response = await claude().beta.messages.parse({
    ...WITH_FALLBACK,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Claude couldn't do this one");
  return response.parsed_output as z.infer<T>;
}

// Menu photos -> dishes, prices and categories (for the owner to check).
export async function extractMenu(images: MenuImage[]): Promise<MenuCategory[]> {
  const out = await parse(
    MenuSchema,
    `You read restaurant and café menus from photos. Copy every dish and drink exactly as written, with its price in pounds and its section. Merge the photos into one menu (they may be pages of the same menu); don't repeat a dish. Don't invent anything that isn't on the menu.`,
    [
      ...images.slice(0, 8).map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } })),
      { type: "text" as const, text: `Here ${images.length === 1 ? "is a photo" : `are ${images.length} photos`} of the menu. Read out every item.` },
    ],
  );
  return out.categories
    .map((c) => ({
      category: c.category.trim() || "Menu",
      items: c.items
        .filter((i) => i.name.trim())
        .map((i) => ({ name: i.name.trim(), price: Math.max(0, Math.round(i.price * 100) / 100), description: i.description?.trim() || null, allergens: [], allergens_confirmed: false })),
    }))
    .filter((c) => c.items.length);
}

const AllergenSchema = z.object({
  items: z.array(z.object({ name: z.string(), allergens: z.array(z.enum(UK_ALLERGENS)) })),
});

// Likely allergens for each dish (the UK's 14), marked unconfirmed until the owner checks them.
export async function suggestAllergens(menu: MenuCategory[]): Promise<MenuCategory[]> {
  const list = menu.flatMap((c) => c.items.map((i) => `- ${i.name}${i.description ? `: ${i.description}` : ""} (${c.category})`)).join("\n");
  const out = await parse(
    AllergenSchema,
    `You suggest which of the UK's 14 allergens a dish probably contains, from its name and description, based on how it's usually made. These are only suggestions: the owner will confirm or correct them. Be cautious: if a dish usually contains an allergen, include it.`,
    `Dishes:\n${list}\n\nFor each dish, list its likely allergens.`,
  );
  const byName = new Map(out.items.map((i) => [i.name.trim().toLowerCase(), i.allergens]));
  return menu.map((c) => ({
    ...c,
    items: c.items.map((i) => ({ ...i, allergens: [...(byName.get(i.name.trim().toLowerCase()) ?? [])], allergens_confirmed: false })),
  }));
}

const CorrectedMenuSchema = z.object({
  categories: z.array(
    z.object({
      category: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          price: z.number(),
          description: z.string().nullable(),
          allergens: z.array(z.enum(UK_ALLERGENS)),
        }),
      ),
    }),
  ),
});

// The owner's correction in their own words ("Lamb Chops is £14", "remove the
// samosa", "add Mango Lassi £3.50 to Drinks", "the biryani has no nuts") applied
// to the menu. Allergens stay unconfirmed: confirming is a separate YES.
export async function applyMenuCorrection(menu: MenuCategory[], instruction: string, opts: { allergens?: boolean } = {}): Promise<MenuCategory[]> {
  const out = await parse(
    CorrectedMenuSchema,
    `You update a restaurant's menu (JSON) with the owner's correction. Change only what they ask${opts.allergens ? " (they are correcting allergens: use only the UK's 14 allergens)" : ""}; keep everything else exactly the same, including every other dish's allergens. Prices are in pounds.`,
    `Menu:\n${JSON.stringify(menu.map((c) => ({ category: c.category, items: c.items.map((i) => ({ name: i.name, price: i.price, description: i.description, allergens: i.allergens ?? [] })) })))}\n\nThe owner says: ${instruction.slice(0, 1000)}`,
    "low",
  );
  const before = new Map(menu.flatMap((c) => c.items).map((i) => [i.name.trim().toLowerCase(), i]));
  return out.categories
    .map((c) => ({
      category: c.category.trim() || "Menu",
      items: c.items
        .filter((i) => i.name.trim())
        .map((i) => ({
          name: i.name.trim(),
          price: Math.max(0, Math.round(i.price * 100) / 100),
          description: i.description?.trim() || null,
          allergens: [...i.allergens],
          // Any change means it needs checking again; otherwise it keeps what it had.
          allergens_confirmed: opts.allergens ? false : Boolean(before.get(i.name.trim().toLowerCase())?.allergens_confirmed),
        })),
    }))
    .filter((c) => c.items.length);
}

const VoiceSchema = z.object({
  options: z
    .array(
      z.object({
        tone: z.string().describe("2-4 words, e.g. 'Warm and chatty'"),
        voice: z.string().describe("How to write as this restaurant, in 2-4 sentences, like a style guide"),
        sample: z.string().describe("A short sample message to customers in this voice, under 280 characters"),
      }),
    )
    .describe("Exactly 3 clearly different options"),
});

// Three different ways the restaurant could sound, from its website and captions.
export async function draftVoices(input: { name: string; cuisine: string | null; websiteText: string; captions: string[]; dishes: string[] }) {
  const out = await parse(
    VoiceSchema,
    `You help a restaurant owner choose how their marketing messages sound. Write 3 clearly different brand voices that could all suit this restaurant, based on how they already write (their website and social captions) when you have it. Each sample is a short message to customers, e.g. a weekend offer or a thank-you, using real dishes. British English. No hashtags.`,
    `Restaurant: ${input.name}${input.cuisine ? ` (${input.cuisine})` : ""}
Some dishes: ${input.dishes.slice(0, 12).join(", ") || "(menu not added yet)"}

Their website says:
${input.websiteText || "(no website text)"}

Their Instagram captions:
${input.captions.length ? input.captions.map((c) => `- ${c}`).join("\n") : "(none given)"}`,
  );
  return out.options.slice(0, 3).map((o) => ({ tone: o.tone.trim(), voice: o.voice.trim(), sample: o.sample.trim() }));
}

// A sensible sign-up reward from the menu: a free drink or small treat (the cheapest
// thing in a drinks or desserts section), else a simple fallback.
export function suggestReward(menu: MenuCategory[]) {
  const treats = menu
    .filter((c) => /drink|dessert|cake|bake|sweet|lassi|coffee|tea/i.test(c.category))
    .flatMap((c) => c.items)
    .filter((i) => i.price > 0 && i.price <= 5)
    .sort((a, b) => a.price - b.price);
  return treats[0] ? `a free ${treats[0].name}` : "a free drink on your next visit";
}

export const DEFAULT_DISCOUNT_CAP = 15;
