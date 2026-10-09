import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { RestaurantContext } from "@/lib/assistant";
import { formatValidity, SEGMENT_LABELS, type CampaignFields } from "@/lib/campaigns";
import { KIND_LABELS, type CheckNotes, type DraftKind } from "@/lib/drafts";

const MODEL = "claude-sonnet-5";

const CheckResult = z.object({
  content: z.string().describe("The draft, with clear factual errors fixed. Unchanged if nothing needed fixing."),
  fixes: z.array(z.string()).describe("Each change you made, in under 15 words"),
  flags: z.array(z.string()).describe("Problems for the owner to decide on, left unchanged, in under 15 words each"),
});

const CampaignCheckResult = z.object({
  subject: z.string().describe("Subject, with clear factual errors fixed"),
  body: z.string().describe("Body, with clear factual errors fixed. Keep {first_name} placeholders as they are."),
  offer: z.string().describe("Offer text. Never change the discount amount."),
  fixes: z.array(z.string()).describe("Each change you made, in under 15 words"),
  flags: z.array(z.string()).describe("Problems for the owner to decide on, left unchanged, in under 15 words each"),
});

// Same independent check for email campaigns, field by field, including
// whether the valid dates make sense with the opening hours.
export async function checkCampaign(ctx: RestaurantContext, fields: CampaignFields): Promise<{ fields: CampaignFields; notes: CheckNotes }> {
  const content = `Subject: ${fields.subject}\n\nBody:\n${fields.body}\n\nOffer: ${fields.offer}\nValid: ${formatValidity(fields.valid_from, fields.valid_until)} (${fields.valid_from} to ${fields.valid_until})\nSegment: ${SEGMENT_LABELS[fields.segment]}`;
  try {
    const response = await new Anthropic().messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium", format: zodOutputFormat(CampaignCheckResult) },
      system: checkerSystem(ctx),
      messages: [
        {
          role: "user",
          content: `Email campaign "${fields.name}". The offer link, opening hours and unsubscribe link are added to the email automatically, so don't flag them as missing. Also check the valid dates against the opening hours (e.g. an offer on a day the restaurant is closed).\n\nCampaign to check:\n"""${content}"""`,
        },
      ],
    });
    const r = response.parsed_output;
    if (response.stop_reason === "refusal" || !r) throw new Error(`Checker gave no result (${response.stop_reason})`);
    return {
      fields: { ...fields, subject: r.subject.trim() || fields.subject, body: r.body.trim() || fields.body, offer: r.offer.trim() || fields.offer },
      notes: { fixes: r.fixes.slice(0, 3), flags: r.flags.slice(0, 3) },
    };
  } catch (err) {
    console.error("Campaign checker failed", err);
    return { fields, notes: { fixes: [], flags: ["The checker couldn't run, so please read this one carefully."] } };
  }
}

// A second, independent Claude call that reviews a draft against the
// restaurant profile before the owner sees it.
export async function checkDraft(
  ctx: RestaurantContext,
  draft: { kind: DraftKind; audience: string; content: string; context?: string },
): Promise<{ content: string; notes: CheckNotes }> {
  const system = checkerSystem(ctx);

  const user = `${KIND_LABELS[draft.kind]} for ${draft.audience}.${draft.context ? `\n\nContext:\n${draft.context}` : ""}

Draft to check:
"""${draft.content}"""`;

  try {
    const response = await new Anthropic().messages.parse({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium", format: zodOutputFormat(CheckResult) },
      system,
      messages: [{ role: "user", content: user }],
    });
    const result = response.parsed_output;
    if (response.stop_reason === "refusal" || !result) throw new Error(`Checker gave no result (${response.stop_reason})`);
    return {
      content: result.content.trim() || draft.content,
      notes: { fixes: result.fixes.slice(0, 3), flags: result.flags.slice(0, 3) },
    };
  } catch (err) {
    console.error("Checker failed", err);
    return { content: draft.content, notes: { fixes: [], flags: ["The checker couldn't run, so please read this one carefully."] } };
  }
}

// The checker's instructions, shared by drafts and campaigns.
function checkerSystem(ctx: RestaurantContext) {
  const profile = {
    name: ctx.data.restaurant.name,
    address: ctx.data.restaurant.address,
    phone: ctx.data.restaurant.phone,
    opening_hours: ctx.data.restaurant.opening_hours,
    menu: ctx.data.restaurant.menu,
    brand_voice: ctx.data.restaurant.brand_voice,
  };

  return `You are a strict fact-checker for customer-facing messages written for ${profile.name}. Review the draft against the restaurant profile.

Check:
1. Prices: every price must exactly match the menu.
2. Dishes: every dish or drink mentioned must be on the menu (small wording differences are fine).
3. Opening hours: any day or time mentioned must match the opening hours.
4. Promises: nothing the restaurant hasn't committed to, such as free items, refunds, compensation, guarantees, delivery or booking promises, or events not in the profile.
5. Tone: it must fit the brand voice.
6. Discounts: the owner's cap is ${ctx.discountCapPercent}% off. Never change a discount amount.

How to respond:
- Fix clear factual mistakes directly in the content (wrong price, wrong hours, wrong dish name, wrong address or phone) and list each one in "fixes".
- Do not change judgement calls. For freebies, compensation, other promises, a discount above the cap, or a tone problem the owner should decide on, leave the text as it is and add a short note to "flags".
- Keep the rest of the message exactly as written. If everything is fine, return the content unchanged with empty lists.

Today is ${ctx.today} (London time).

Restaurant profile (JSON):
${JSON.stringify(profile, null, 2)}`;
}
