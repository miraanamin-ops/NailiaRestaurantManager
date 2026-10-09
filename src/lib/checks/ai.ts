import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { RestaurantContext } from "@/lib/assistant";
import { claude, MAX_TOKENS, MODEL, WITH_FALLBACK } from "@/lib/claude";
import { checkResult, type CheckResult } from "./types";

// The two AI checks. Each is a separate, independent Claude call with one job,
// and each can fix the draft or flag a problem for the owner.
//   facts: prices, dishes, opening hours, offers and promises against the profile
//   tone:  the restaurant's brand voice and language

export type CheckItem = {
  label: string; // e.g. "Review reply for Google review by Ollie T."
  context?: string; // e.g. the review being replied to
  fields: Record<string, string>; // what's being checked: { content } or { subject, body, offer }
};

function profileOf(ctx: RestaurantContext) {
  const r = ctx.data.restaurant;
  return { name: r.name, address: r.address, phone: r.phone, opening_hours: r.opening_hours, menu: r.menu, brand_voice: r.brand_voice };
}

const FACTS_RULES = (ctx: RestaurantContext) => `You check the FACTS in customer-facing messages written for ${ctx.restaurantName}, against the restaurant profile below. Ignore tone and style: another check handles those.

Check:
1. Prices: every price must exactly match the menu.
2. Dishes and drinks: everything mentioned must be on the menu (small wording differences are fine).
3. Opening hours: any day or time must match the opening hours; offers mustn't fall on a day it's closed.
4. Offers and promises: nothing the restaurant hasn't committed to (free items, refunds, compensation, delivery or booking promises, events not in the profile).
5. Contact details: address and phone must match.
6. Discounts: the owner's cap is ${ctx.discountCapPercent}% off. Never change a discount amount.

How to respond:
- Fix clear factual mistakes directly (wrong price, hours, dish name, address or phone) and list each one in "fixes".
- Don't change judgement calls: for freebies, compensation, other promises, or a discount above the cap, leave the text and add a short note to "flags".
- Thanking, apologising and inviting people to call or come back are normal hospitality, not promises.
- Keep everything else exactly as written. If all is fine, return the fields unchanged with empty lists.`;

const TONE_RULES = (ctx: RestaurantContext) => `You check the BRAND AND TONE of customer-facing messages written for ${ctx.restaurantName}. Facts have already been checked: never change prices, dishes, times, dates, offers, names or contact details.

Check:
1. Voice: it must match the brand voice in the profile below.
2. Language: British English spelling and phrasing, in the language the restaurant writes in.
3. Style: not pushy or salesy, no ALL CAPS shouting, emojis as the brand voice allows.
4. Review replies: grateful, sincere, never arguing with the customer; with bad reviews, an apology and an invitation to get in touch.

How to respond:
- Make small wording fixes yourself (spelling, a pushy phrase, too many emojis) and list each one in "fixes".
- If the whole message is in the wrong tone, or something needs the owner's judgement, leave it and add a short note to "flags".
- Only comment on voice, language and style. Prices, offers, freebies, dates and facts are another check's job: never fix or flag them.
- Keep {first_name} placeholders exactly as they are, and never add placeholders that weren't there. If all is fine, return the fields unchanged with empty lists.`;

function system(ctx: RestaurantContext, rules: string) {
  // Same text for every check that day, so it's cached: repeat checks cost far less.
  const text = `${rules}\n\nToday is ${ctx.today} (London time).\n\nRestaurant profile (JSON):\n${JSON.stringify(profileOf(ctx), null, 2)}`;
  return [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }];
}

async function runCheck(ctx: RestaurantContext, which: "facts" | "tone", item: CheckItem) {
  const keys = Object.keys(item.fields);
  const schema = z.object({
    fields: z.object(Object.fromEntries(keys.map((k) => [k, z.string()]))).describe("The same fields, with your fixes applied"),
    fixes: z.array(z.string()).describe("Each change you made, in under 15 words"),
    flags: z.array(z.string()).describe("Problems for the owner to decide on, left unchanged, in under 15 words each"),
  });
  const response = await claude().beta.messages.parse({
    ...WITH_FALLBACK,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: which === "facts" ? "medium" : "low", format: betaZodOutputFormat(schema) },
    system: system(ctx, which === "facts" ? FACTS_RULES(ctx) : TONE_RULES(ctx)),
    messages: [
      {
        role: "user",
        content: `${item.label}.${item.context ? `\n\nContext:\n${item.context}` : ""}\n\nFields to check (JSON):\n${JSON.stringify(item.fields, null, 2)}`,
      },
    ],
  });
  const out = response.parsed_output;
  if (response.stop_reason === "refusal" || !out) throw new Error(`The ${which} check gave no result (${response.stop_reason})`);
  // Keep the original wording for any field that came back empty.
  const fields = Object.fromEntries(keys.map((k) => [k, (out.fields as Record<string, string>)[k]?.trim() || item.fields[k]]));
  // At most two notes of each kind per check, so the WhatsApp message stays readable.
  return { fields, fixes: out.fixes.slice(0, 2), flags: out.flags.slice(0, 2) };
}

// Runs one AI check. If it can't run, the draft is unchanged and flagged for a careful read.
export async function aiCheck(ctx: RestaurantContext, which: "facts" | "tone", item: CheckItem): Promise<{ fields: Record<string, string>; result: CheckResult }> {
  try {
    const out = await runCheck(ctx, which, item);
    return { fields: out.fields, result: checkResult(out.fixes, out.flags) };
  } catch (err) {
    console.error(`The ${which} check failed`, err);
    return { fields: item.fields, result: checkResult([], ["couldn't run, so please read this one carefully"], "failed") };
  }
}
