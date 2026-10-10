import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { google } from "@/lib/google";
import { getSupabase, restaurantNow, type Customer, type Restaurant } from "@/lib/supabase";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { claude, MAX_TOKENS, MODEL, WITH_FALLBACK } from "@/lib/claude";
import { customerSummary, lookUpCustomers, lookUpReviews, reviewSummary } from "@/lib/claude-data";
import { londonLongDate } from "@/lib/clock";
import type { ProfileChange } from "@/lib/onboarding/profile-changes";
import { customerSafeMenu } from "@/lib/onboarding/profile-data";
import { clip } from "@/lib/text";
import { z } from "zod";
import {
  formatValidity,
  normaliseDates,
  recentCampaignStats,
  recipientsFor,
  SEGMENT_LABELS,
  SEGMENTS,
  upcomingCalendar,
  type CampaignFields,
  type Segment,
} from "@/lib/campaigns";
import { DRAFT_KINDS, KIND_LABELS, type Draft, type DraftKind, type getLearningContext } from "@/lib/drafts";

// Drafts must fit in a WhatsApp button message (1024 chars) with a header.
const DRAFT_MAX_CHARS = 700;
const CHAT_MAX_CHARS = 1600;

export type StoredMessage = {
  direction: "inbound" | "outbound";
  body: string;
  status: string;
};

type Learning = Awaited<ReturnType<typeof getLearningContext>>;

// Birthdays (any year) in the next 7 days, today included.
function upcomingBirthdays(customers: Customer[], today: Date) {
  const result: { name: string; date: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() + i);
    for (const c of customers) {
      if (!c.birthday) continue;
      const [, m, d] = c.birthday.split("-").map(Number);
      if (day.getUTCMonth() + 1 === m && day.getUTCDate() === d) {
        result.push({ name: c.name, date: londonLongDate(day) });
      }
    }
  }
  return result;
}

// Loads ONE restaurant (always by its id), its customers and reviews, and turns
// them into the background knowledge Claude gets. Nothing from any other
// restaurant is ever loaded into the same context.
// realTime: scheduled jobs always run on the real clock, never the TIME test clock.
export async function loadRestaurantContext(restaurantId: string, { realTime = false }: { realTime?: boolean } = {}) {
  const supabase = getSupabase();
  const { data: restaurant, error } = await supabase
    .from("restaurants")
    .select("*")
    .eq("id", restaurantId)
    .maybeSingle<Restaurant>();
  if (error) throw error;
  if (!restaurant) throw new Error(`Restaurant ${restaurantId} not found`);

  const [customersRes, reviews] = await Promise.all([
    supabase.from("customers").select("*").eq("restaurant_id", restaurant.id).order("name").returns<Customer[]>(),
    google().listReviews(restaurant.id),
  ]);
  if (customersRes.error) throw customersRes.error;

  const customers = customersRes.data ?? [];
  const today = realTime ? new Date() : restaurantNow(restaurant);

  // What Claude sees on every message: the profile and short summaries only.
  // Specific reviews and customers are looked up when a message needs them
  // (look_up_reviews / look_up_customers in chat). Customer contact details are never sent.
  const data = {
    restaurant: {
      name: restaurant.name,
      cuisine: restaurant.cuisine,
      address: restaurant.address,
      phone: restaurant.phone,
      opening_hours: restaurant.opening_hours,
      // Allergens only once the owner has confirmed them (never guesses, in anything customers see).
      menu: customerSafeMenu(restaurant.menu ?? []),
      brand_voice: restaurant.brand_voice,
      signup_reward: restaurant.signup_reward,
    },
    review_summary: reviewSummary(reviews, today),
    customer_summary: customerSummary(customers, today),
  };

  return {
    restaurant,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    discountCapPercent: restaurant.discount_cap_percent,
    now: today,
    data,
    reviews,
    customers,
    today: londonLongDate(today),
    birthdaysThisWeek: upcomingBirthdays(customers, today),
  };
}

export type RestaurantContext = Awaited<ReturnType<typeof loadRestaurantContext>>;

function learningText(learning: Learning) {
  const lines: string[] = [];
  if (learning.feedback.length) {
    lines.push("Recent feedback from the owner on your drafts (newest first). Follow it closely; this is how they like things written:");
    for (const f of learning.feedback) {
      const kind = f.draft_kind ? KIND_LABELS[f.draft_kind as DraftKind] ?? f.draft_kind : "Draft";
      lines.push(
        f.kind === "edit"
          ? `- ${kind}: asked to change it: "${f.note}"`
          : `- ${kind}: skipped it because: "${f.note}"`,
      );
    }
  }
  if (learning.approved.length) {
    lines.push("", "Recently approved drafts (good examples of the right tone):");
    for (const a of learning.approved) lines.push(`- ${KIND_LABELS[a.kind]}: """${a.content}"""`);
  }
  return lines.length ? lines.join("\n") : "No feedback on drafts yet.";
}

// "chat": talking with the owner on WhatsApp, with drafting tools available.
// "write": producing just the text of one draft, with no tools.
// "campaign": producing the structured fields of one email campaign.
// "post": producing one Google post.
type Mode = "chat" | "write" | "campaign" | "post";

const CHAT_INSTRUCTIONS = `Chatting with the owner:
- This is WhatsApp. Keep replies short and easy to read on a phone, ideally under 120 words.
- Use WhatsApp formatting only: *bold*, _italic_, and simple "- " bullet lists. No markdown headings, tables or links.
- Talk to the owner like a helpful, friendly colleague.
- When the owner wants an offer, promotion or birthday email for customers, call create_email_campaign.
- For a review reply or any other one-off public message, call create_draft.
- Never write these out in chat: the tools send the owner a preview with Approve, Edit and Skip buttons.
- For specific reviews (what someone said, which ones need replies, the id a review reply needs), call look_up_reviews. For specific customers (a name, a birthday, the id a message needs), call look_up_customers. Look up just what this message needs.`;

const WRITE_INSTRUCTIONS = `You are writing one draft right now. Reply with only the finished message text, exactly as it would be sent: no intro, no explanation, no quotes around it, no JSON or code.`;

const CAMPAIGN_INSTRUCTIONS = `You are writing one email campaign right now. Fill in every field following the email campaign guidelines.`;

const POST_INSTRUCTIONS = `You are writing one Google post right now.`;

function systemPrompt(
  ctx: RestaurantContext,
  learning: Learning,
  activeDraft: Draft | null,
  mode: Mode,
  extra = "",
): Anthropic.Beta.BetaTextBlockParam[] {
  const background = `You are Naila, a WhatsApp marketing assistant for the owner of ${ctx.restaurantName}. You work for the restaurant owner (not for customers).

You help the owner understand how the restaurant is doing and grow it: summarise and analyse reviews, spot patterns, know the regular customers and upcoming birthdays, suggest simple marketing ideas, and write drafts of customer-facing messages for them to approve.

Base every fact on the restaurant data below. It has the restaurant's profile and summaries of its reviews and customers, not every review and customer. If something isn't in the data (or in what you look up), say you don't have it rather than guessing.

Writing drafts (review replies and other one-off messages):
- Write in the restaurant's brand voice, ready to send as-is: no placeholders like [Name], under ${DRAFT_MAX_CHARS} characters.
- Use real details from the data: customer first names, menu items, prices and opening hours. Offers are suggestions for the owner to approve, so you can propose a concrete deal.
- Don't offer freebies, refunds or other promises unless the owner asks for them.
- Approved review replies are posted under the review on Google.

Google reviews pasted by the owner: if the owner pastes or forwards a review (from Google or anywhere else) and wants a reply they can post themselves, call draft_pasted_review_reply with the review details. They'll get a reply to copy and paste.

Email campaigns (how customers hear about offers; customers are reached by email, never WhatsApp):
- When the owner wants to fill a quiet time, push a dish, or run any offer for customers, create an email campaign.
- name: a short internal label the owner will recognise later, e.g. "Quiet Thursday grill deal".
- subject: short and inviting, no ALL CAPS, at most one emoji.
- body: 2 to 4 short paragraphs, under 600 characters, in the brand voice. You may start with "Hi {first_name}," ({first_name} is filled in for each customer). Don't include links, the offer box, opening hours boilerplate or unsubscribe text: those are added automatically.
- offer: short and concrete, e.g. "20% off all grills" or "Free Mango Lassi with any main". Stay within the discount cap.
- valid_from / valid_until: the London dates the offer can be used, as YYYY-MM-DD. Use the calendar you're given. For "Thursday is quiet" that's the next Thursday only; for "this weekend" it's Saturday and Sunday (or Friday to Sunday if the owner says so).
- segment: "everyone", "birthdays_7d" (birthdays in the next 7 days) or "unredeemed_signups" (new sign-ups who haven't used their welcome reward). Use "everyone" unless the owner's request points to one of the others.
- Approved campaigns go through the safety rules, and only customers with email consent receive them.

Campaign results: when the owner asks how a campaign did (e.g. "how did Thursday do?"), answer briefly from the campaign results you're given: sent, opened, clicked, redeemed. Be honest that simulated sends (test mode) can't be opened or redeemed.

Restaurant data (JSON):
${JSON.stringify(ctx.data, null, 2)}`;

  const today = `Today is ${ctx.today} (London time). Customer birthdays in the next 7 days: ${
    ctx.birthdaysThisWeek.length
      ? ctx.birthdaysThisWeek.map((b) => `${b.name} (${b.date})`).join(", ")
      : "none"
  }.
Discount cap: offers can be at most ${ctx.discountCapPercent}% off, unless the owner explicitly asks for more (anything above the cap will be blocked when sending).`;

  const active =
    activeDraft?.waiting_for === "decision"
      ? `A draft is waiting for the owner to tap Approve, Edit or Skip:
${KIND_LABELS[activeDraft.kind]} for ${activeDraft.audience}: """${activeDraft.content}"""
If the owner's message asks for changes to this draft, call revise_current_draft rather than create_draft.`
      : "No draft is currently waiting for approval.";

  const modeText =
    mode === "chat"
      ? [CHAT_INSTRUCTIONS, active]
      : mode === "campaign"
        ? [CAMPAIGN_INSTRUCTIONS]
        : mode === "post"
          ? [POST_INSTRUCTIONS, POST_GUIDE]
          : [WRITE_INSTRUCTIONS];

  return [
    // The big background block is the same in every mode and rarely changes,
    // so cache it to make replies faster and cheaper.
    { type: "text", text: background, cache_control: { type: "ephemeral" } },
    { type: "text", text: [today, extra, learningText(learning), ...modeText].filter(Boolean).join("\n\n") },
  ];
}

const createDraftTool: Anthropic.Beta.BetaTool = {
  name: "create_draft",
  description:
    "Save a new draft for the owner to approve: a review reply or another one-off public message. For offers, promotions and birthday emails to customers, use create_email_campaign instead.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["review_reply", "other"], description: "Type of draft" },
      content: { type: "string", description: "The finished message, exactly as it would be sent" },
      audience: {
        type: "string",
        description: 'Who it would go to, e.g. "Google review by Peter W.", "Aisha Rahman (birthday)", "All opted-in customers"',
      },
      review_id: { type: "string", description: "For review replies: the id of the review being replied to" },
      customer_id: { type: "string", description: "For messages to one customer: their id" },
    },
    required: ["kind", "content", "audience"],
  },
};

const CAMPAIGN_PROPERTIES = {
  name: { type: "string", description: 'Short internal label, e.g. "Quiet Thursday grill deal"' },
  subject: { type: "string", description: "Email subject line" },
  body: { type: "string", description: "Email body, 2-4 short paragraphs; may use {first_name}" },
  offer: { type: "string", description: 'The offer, e.g. "20% off all grills"' },
  valid_from: { type: "string", description: "First valid day, YYYY-MM-DD (London)" },
  valid_until: { type: "string", description: "Last valid day, YYYY-MM-DD (London)" },
  segment: { type: "string", enum: [...SEGMENTS], description: "Who gets it" },
} as const;

const createCampaignTool: Anthropic.Beta.BetaTool = {
  name: "create_email_campaign",
  description:
    "Draft an email campaign with an offer for customers. The owner gets a preview to approve; each customer then gets their own one-time offer link.",
  input_schema: {
    type: "object",
    properties: CAMPAIGN_PROPERTIES,
    required: ["name", "subject", "body", "offer", "valid_from", "valid_until", "segment"],
  },
};

const CampaignSchema = z.object({
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  offer: z.string(),
  valid_from: z.string().describe("YYYY-MM-DD"),
  valid_until: z.string().describe("YYYY-MM-DD"),
  segment: z.enum(SEGMENTS),
});

// Turns whatever the model produced into safe campaign fields (plain code).
function toCampaignFields(raw: Record<string, unknown>, now: Date, fallbackSegment: Segment = "everyone"): CampaignFields | null {
  const str = (k: string, max: number) => (typeof raw[k] === "string" ? (raw[k] as string).trim().slice(0, max) : "");
  const fields = {
    name: str("name", 80) || "Email offer",
    subject: str("subject", 120),
    body: str("body", 1200),
    offer: str("offer", 120),
    segment: SEGMENTS.includes(raw.segment as Segment) ? (raw.segment as Segment) : fallbackSegment,
    ...normaliseDates(str("valid_from", 10), str("valid_until", 10), now),
  };
  return fields.subject && fields.body && fields.offer ? fields : null;
}

// Segment sizes, a date calendar and recent campaign results, for chat and campaign writing.
export async function campaignContext(ctx: RestaurantContext) {
  const [counts, stats] = await Promise.all([
    Promise.all(SEGMENTS.map(async (s) => [s, (await recipientsFor(ctx.restaurant, s, ctx.now)).eligible.length] as const)),
    recentCampaignStats(ctx.restaurantId),
  ]);
  const results = stats.length
    ? stats
        .map(
          (s) =>
            `- "${s.campaign.name}" (offer: ${s.campaign.offer}; valid ${formatValidity(s.campaign.valid_from, s.campaign.valid_until)}; to ${SEGMENT_LABELS[s.campaign.segment]}; sent ${s.campaign.sent_at?.slice(0, 10)}): ${s.emailed} real emails, ${s.simulated} simulated (test mode), ${s.excluded} left out for no consent; opened ${s.opened}, clicked ${s.clicked}, redeemed ${s.redeemed}`,
        )
        .join("\n")
    : "No campaigns sent yet.";
  return `Calendar (London):\n${upcomingCalendar(ctx.now)}\n\nCustomers with email consent per segment: ${counts.map(([s, n]) => `${s} = ${n}`).join(", ")}\n\nRecent campaign results (newest first):\n${results}`;
}

async function writeCampaign(ctx: RestaurantContext, learning: Learning, request: string, fallbackSegment: Segment) {
  const response = await claude().beta.messages.parse({
    ...WITH_FALLBACK,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "medium", format: betaZodOutputFormat(CampaignSchema) },
    system: systemPrompt(ctx, learning, null, "campaign", await campaignContext(ctx)),
    messages: [{ role: "user", content: request }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Claude couldn't write this campaign");
  const fields = toCampaignFields(response.parsed_output, ctx.now, fallbackSegment);
  if (!fields) throw new Error("Claude returned an incomplete campaign");
  return fields;
}

export function rewriteCampaign(ctx: RestaurantContext, learning: Learning, campaign: CampaignFields, instruction: string) {
  return writeCampaign(
    ctx,
    learning,
    `Here is an email campaign draft:\n${JSON.stringify(campaign, null, 2)}\n\nThe owner wants this change: "${instruction}"\n\nRewrite the campaign with that change. Keep everything else that was good about it.`,
    campaign.segment,
  );
}

// The Monday birthday email: offer valid from today until next Sunday.
export function writeBirthdayCampaign(ctx: RestaurantContext, learning: Learning) {
  return writeCampaign(
    ctx,
    learning,
    `It's the start of the week. Write a warm birthday email for customers with a birthday in the next 7 days (segment "birthdays_7d"). Start with "Hi {first_name}," and wish them a happy birthday. Give a small birthday treat they can claim during their birthday week, valid from today for 7 days.`,
    "birthdays_7d",
  );
}

const pastedReviewTool: Anthropic.Beta.BetaTool = {
  name: "draft_pasted_review_reply",
  description:
    "The owner pasted or forwarded a review and wants a reply they can copy into Google themselves. Pass the review details exactly as given.",
  input_schema: {
    type: "object",
    properties: {
      author_name: { type: "string", description: "Reviewer's name, or 'the reviewer' if unknown" },
      rating: { type: "integer", minimum: 1, maximum: 5, description: "Star rating, if known" },
      text: { type: "string", description: "The review text, word for word" },
    },
    required: ["author_name", "text"],
  },
};

const reviseDraftTool: Anthropic.Beta.BetaTool = {
  name: "revise_current_draft",
  description: "Rewrite the draft that is waiting for approval, following the owner's requested changes.",
  input_schema: {
    type: "object",
    properties: {
      instruction: { type: "string", description: "The owner's requested change, in a few words" },
      content: { type: "string", description: "The rewritten message, exactly as it would be sent" },
    },
    required: ["instruction", "content"],
  },
};

// Look-ups: only the specific reviews or customers a message needs reach Claude.
const lookUpReviewsTool: Anthropic.Beta.BetaTool = {
  name: "look_up_reviews",
  description: `Find specific Google reviews (newest first, at most 10): by stars, unreplied only, or words in the author or text. Returns each review's id (needed to draft a reply), author, rating, date, text and any posted reply.`,
  input_schema: {
    type: "object",
    properties: {
      min_rating: { type: "integer", minimum: 1, maximum: 5 },
      max_rating: { type: "integer", minimum: 1, maximum: 5 },
      unreplied_only: { type: "boolean", description: "Only reviews without a posted reply" },
      search: { type: "string", description: "Words to find in the reviewer's name or the review text" },
      limit: { type: "integer", minimum: 1, maximum: 10 },
    },
  },
};

const lookUpCustomersTool: Anthropic.Beta.BetaTool = {
  name: "look_up_customers",
  description: `Find specific customers (at most 10): by name, or with a birthday within N days. Returns id, name, birthday, visits, last visit, email consent and notes (no contact details).`,
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "All or part of the customer's name" },
      birthday_within_days: { type: "integer", minimum: 0, maximum: 60 },
      limit: { type: "integer", minimum: 1, maximum: 10 },
    },
  },
};

// "Change Friday hours to 11pm", "add lamb chops, £14": the owner changing the restaurant's own details.
const changeDetailsTool: Anthropic.Beta.BetaTool = {
  name: "change_restaurant_details",
  description:
    "The owner clearly asks to change the restaurant's own details: opening hours, a dish (add, change price, remove), the sign-up reward, the discount cap, phone, address or website. Not for drafting messages. One entry per change.",
  input_schema: {
    type: "object",
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            change: { type: "string", enum: ["hours", "add_dish", "dish_price", "remove_dish", "reward", "discount_cap", "phone", "address", "website"] },
            day: { type: "string", description: 'For hours: a day ("Friday"), "every day", "weekdays" or "weekend"' },
            open: { type: "string", description: "For hours: new opening time, 24-hour HH:MM. Leave out if unchanged" },
            close: { type: "string", description: "For hours: new closing time, 24-hour HH:MM (11pm = 23:00, midnight = 24:00). Leave out if unchanged" },
            closed: { type: "boolean", description: "For hours: closed all day" },
            name: { type: "string", description: "For dishes: the dish name (as on the menu, if it's there)" },
            price: { type: "number", description: "For dishes: price in pounds, e.g. 14 or 7.95" },
            category: { type: "string", description: "For a new dish: the menu section it goes in, if said" },
            value: { type: "string", description: "For reward, phone, address or website: the new value" },
            percent: { type: "number", description: "For discount_cap: the new cap" },
          },
          required: ["change"],
        },
      },
    },
    required: ["changes"],
  },
};

const LOOKUP_ROUNDS = 4;

function runLookUp(ctx: RestaurantContext, tool: Anthropic.Beta.BetaToolUseBlock) {
  const input = (tool.input ?? {}) as Record<string, unknown>;
  const num = (k: string) => (typeof input[k] === "number" ? (input[k] as number) : undefined);
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : undefined);
  if (tool.name === "look_up_reviews") {
    return lookUpReviews(ctx.reviews, {
      min_rating: num("min_rating"),
      max_rating: num("max_rating"),
      unreplied_only: input.unreplied_only === true,
      search: str("search"),
      limit: num("limit"),
    });
  }
  return lookUpCustomers(ctx.customers, { name: str("name"), birthday_within_days: num("birthday_within_days"), limit: num("limit") }, ctx.now);
}

// Turns stored WhatsApp messages (oldest first) into a Claude conversation.
function toClaudeMessages(history: StoredMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = history
    .filter((m) => m.body.trim() && m.status !== "failed")
    .map((m) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body,
    }));
  // A conversation must start with the user and end with the user.
  while (messages.length && messages[0].role !== "user") messages.shift();
  while (messages.length && messages[messages.length - 1].role !== "user") messages.pop();
  return messages;
}

function textOf(response: Anthropic.Beta.BetaMessage) {
  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export type ChatResult =
  | { type: "text"; text: string }
  | {
      type: "draft";
      kind: DraftKind;
      content: string;
      audience: string;
      reviewId: string | null;
      customerId: string | null;
    }
  | { type: "revise"; instruction: string; content: string }
  | { type: "campaign"; fields: CampaignFields }
  | { type: "pasted_review"; authorName: string; rating: number | null; text: string }
  | { type: "profile_changes"; changes: ProfileChange[] };

// A normal WhatsApp message from the owner: answer it, or produce a draft.
export async function chat(
  ctx: RestaurantContext,
  learning: Learning,
  activeDraft: Draft | null,
  history: StoredMessage[],
): Promise<ChatResult> {
  const messages = toClaudeMessages(history);
  if (!messages.length) return { type: "text", text: "Hi! 👋 Send me a question about the restaurant and I'll help." };

  const tools = [
    createCampaignTool,
    createDraftTool,
    pastedReviewTool,
    ...(activeDraft?.waiting_for === "decision" ? [reviseDraftTool] : []),
    lookUpReviewsTool,
    lookUpCustomersTool,
    changeDetailsTool,
  ];
  const system = systemPrompt(ctx, learning, activeDraft, "chat", await campaignContext(ctx));
  const isLookUp = (b: Anthropic.Beta.BetaContentBlock): b is Anthropic.Beta.BetaToolUseBlock =>
    b.type === "tool_use" && (b.name === "look_up_reviews" || b.name === "look_up_customers");

  // Claude may look things up first (a few rounds at most), then answer or draft.
  let response: Anthropic.Beta.BetaMessage | null = null;
  for (let round = 0; round < LOOKUP_ROUNDS; round++) {
    response = await claude().beta.messages.create({
      ...WITH_FALLBACK,
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "low" }, // quick chat replies keep WhatsApp responsive
      system,
      tools,
      messages,
    });
    if (response.stop_reason === "refusal") {
      return { type: "text", text: "Sorry, I can't help with that one. Try asking me something else about the restaurant." };
    }
    const lookUps = response.content.filter(isLookUp);
    const action = response.content.some((b) => b.type === "tool_use" && !isLookUp(b));
    if (action || !lookUps.length || response.stop_reason !== "tool_use") break;
    // Pass the whole turn back unchanged (including any thinking), then the results.
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: lookUps.map((t) => ({ type: "tool_result" as const, tool_use_id: t.id, content: JSON.stringify(runLookUp(ctx, t)) })),
    });
  }
  if (!response) return { type: "text", text: "Sorry, I couldn't come up with an answer. Could you rephrase that?" };

  const toolUse = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && !isLookUp(b));
  if (toolUse?.name === "draft_pasted_review_reply") {
    const input = toolUse.input as Record<string, unknown>;
    if (typeof input.text === "string" && input.text.trim()) {
      const rating = typeof input.rating === "number" && input.rating >= 1 && input.rating <= 5 ? Math.round(input.rating) : null;
      return {
        type: "pasted_review",
        authorName: typeof input.author_name === "string" && input.author_name.trim() ? input.author_name.trim().slice(0, 80) : "the reviewer",
        rating,
        text: input.text.trim().slice(0, 4000),
      };
    }
  }
  if (toolUse?.name === "change_restaurant_details") {
    const changes = (toolUse.input as { changes?: unknown }).changes;
    if (Array.isArray(changes) && changes.length) return { type: "profile_changes", changes: changes.slice(0, 20) as ProfileChange[] };
  }
  if (toolUse?.name === "create_email_campaign") {
    const fields = toCampaignFields(toolUse.input as Record<string, unknown>, ctx.now);
    if (fields) return { type: "campaign", fields };
  }
  if (toolUse?.name === "create_draft") {
    const input = toolUse.input as Record<string, unknown>;
    const kind = DRAFT_KINDS.includes(input.kind as DraftKind) ? (input.kind as DraftKind) : "other";
    const reviewId = typeof input.review_id === "string" && ctx.reviews.some((r) => r.id === input.review_id) ? input.review_id : null;
    const customerId = typeof input.customer_id === "string" && ctx.customers.some((c) => c.id === input.customer_id) ? input.customer_id : null;
    if (typeof input.content === "string" && input.content.trim()) {
      return {
        type: "draft",
        kind,
        content: clip(input.content.trim(), DRAFT_MAX_CHARS + 200),
        audience: typeof input.audience === "string" && input.audience.trim() ? input.audience.trim() : "Customers",
        reviewId,
        customerId,
      };
    }
  }
  if (toolUse?.name === "revise_current_draft") {
    const input = toolUse.input as Record<string, unknown>;
    if (typeof input.content === "string" && input.content.trim()) {
      return {
        type: "revise",
        instruction: typeof input.instruction === "string" ? input.instruction : "Owner asked for changes",
        content: clip(input.content.trim(), DRAFT_MAX_CHARS + 200),
      };
    }
  }

  const text = textOf(response);
  return { type: "text", text: text ? clip(text, CHAT_MAX_CHARS) : "Sorry, I couldn't come up with an answer. Could you rephrase that?" };
}

async function writeOnly(ctx: RestaurantContext, learning: Learning, request: string) {
  const response = await claude().beta.messages.create({
    ...WITH_FALLBACK,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "medium" },
    system: systemPrompt(ctx, learning, null, "write"),
    messages: [{ role: "user", content: request }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to write this draft");
  const text = unwrapJson(textOf(response));
  if (!text) throw new Error("Claude returned an empty draft");
  return clip(text, DRAFT_MAX_CHARS + 200);
}

// Safety net: if the model wraps the draft in JSON, pull out just the message.
function unwrapJson(text: string) {
  if (!text.startsWith("{")) return text;
  try {
    const parsed = JSON.parse(text);
    const content = parsed?.content ?? parsed?.parameters?.content ?? parsed?.input?.content;
    return typeof content === "string" && content.trim() ? content.trim() : text;
  } catch {
    return text;
  }
}

type ReviewInput = { author_name: string; rating: number | null; text: string | null };

// Low ratings (1-3) get a careful reply: apologise, don't argue, take it offline.
export function writeReviewReply(ctx: RestaurantContext, learning: Learning, review: ReviewInput) {
  const careful =
    review.rating !== null && review.rating <= 3
      ? `\n\nThis is a ${review.rating}-star review, so be careful: thank them, apologise sincerely for the specific problem without making excuses or arguing, don't promise refunds or freebies, and invite them to contact the restaurant directly (phone ${ctx.data.restaurant.phone}) so the owner can put it right. Keep it short, warm and public-facing.`
      : "";
  return writeOnly(
    ctx,
    learning,
    `A ${review.rating ? `${review.rating}-star ` : ""}Google review from ${review.author_name}:\n"""${review.text ?? "(no text, just a rating)"}"""\n\nWrite the restaurant's public reply to this review.${careful}`,
  );
}

export const POST_TOPICS = ["update", "offer", "event"] as const;
const PostSchema = z.object({
  topic: z.enum(POST_TOPICS).describe("update = a dish or news, offer = a deal, event = something happening on a date"),
  text: z.string().describe("The Google post text"),
});
const POST_GUIDE = `Google posts appear on the restaurant's Google listing. Write 2 to 4 short sentences (under 600 characters) in the brand voice, about something concrete from the data: a dish with its price, an offer within the discount cap, or an event or occasion. End with a simple call to action like "Pop in tonight" or "See you this weekend". No hashtags, at most two emojis, no links.`;

async function writePostFields(ctx: RestaurantContext, learning: Learning, content: Anthropic.Beta.BetaMessageParam["content"]) {
  const response = await claude().beta.messages.parse({
    ...WITH_FALLBACK,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "medium", format: betaZodOutputFormat(PostSchema) },
    system: systemPrompt(ctx, learning, null, "post"),
    messages: [{ role: "user", content }],
  });
  const out = response.parsed_output;
  if (response.stop_reason === "refusal" || !out?.text.trim()) throw new Error("Claude couldn't write this post");
  return { topic: out.topic, text: clip(out.text.trim(), DRAFT_MAX_CHARS + 200) };
}

// The twice-weekly post. `avoid` lists recent posts so they don't repeat.
export function writeGooglePost(ctx: RestaurantContext, learning: Learning, avoid: string[]) {
  return writePostFields(
    ctx,
    learning,
    `Write this week's Google post. Pick one of: a dish worth shouting about, an offer, or an event/occasion coming up. Make it different from these recent posts:\n${avoid.length ? avoid.map((p) => `- ${p}`).join("\n") : "(none yet)"}`,
  );
}

// A photo the owner sent on WhatsApp: Claude looks at it and writes the caption.
export function captionPhoto(
  ctx: RestaurantContext,
  learning: Learning,
  photo: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" },
  ownerNote: string,
) {
  return writePostFields(ctx, learning, [
    { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.base64 } },
    {
      type: "text",
      text: `The owner sent this photo to post on Google.${ownerNote ? ` Their note: "${ownerNote}"` : ""}\n\nWrite the post that goes with it. Describe what's actually in the photo, and only name a dish if you can tell what it is (or the owner said). Don't invent prices or offers that aren't in the data or the note.`,
    },
  ]);
}

const ReportInsightsSchema = z.object({
  sentence: z.string().describe("One plain-English sentence summing up the week, under 25 words"),
  praise: z.array(z.string()).describe("Up to 3 things customers praised, a few words each"),
  complaints: z.array(z.string()).describe("Up to 3 things customers complained about, a few words each"),
  actions: z
    .array(
      z.object({
        title: z.string().describe("The action, under 8 words, e.g. 'Fill quiet Tuesday with a grill offer'"),
        why: z.string().describe("Why, in one short sentence based on the numbers"),
        message: z.string().describe("What the owner sends to their WhatsApp assistant to start it, e.g. 'Tuesday is quiet, draft a 15% off grills email for everyone'"),
      }),
    )
    .describe("Exactly 3 actions for next week"),
});
export type ReportInsights = z.infer<typeof ReportInsightsSchema>;

// The weekly report's words: summary sentence, review themes and next week's
// actions. The numbers themselves are worked out in plain code and given here.
export async function writeReportInsights(ctx: RestaurantContext, facts: string, reviewTexts: string[]) {
  const response = await claude().beta.messages.parse({
    ...WITH_FALLBACK,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "medium", format: betaZodOutputFormat(ReportInsightsSchema) },
    system: `You write the weekly report for the owner of ${ctx.restaurantName}, a ${ctx.restaurant.cuisine ?? "restaurant"} at ${ctx.restaurant.address ?? "an independent site"}. The owner reads it on their phone: plain English, short, specific, no jargon, no hype.

Only use facts you're given. Don't invent numbers, dishes or events.

Actions must be things the owner's WhatsApp assistant can start right now:
- an email campaign with an offer (segments: everyone, birthdays in the next 7 days, new sign-ups who haven't used their welcome reward), within a ${ctx.discountCapPercent}% discount cap
- a Google post about a dish, offer or event
- replying to reviews, or changing the sign-up reward
- a practical fix suggested by a complaint (the assistant can help word a reply or a post about it)
Each action's "message" is written as the owner talking to the assistant, ready to send.

Menu: ${ctx.restaurant.menu.flatMap((c) => c.items.map((i) => `${i.name} £${i.price.toFixed(2)}`)).join(", ")}
Opening hours: ${Object.entries(ctx.restaurant.opening_hours).map(([d, h]) => `${d} ${h}`).join(", ")}`,
    messages: [
      {
        role: "user",
        content: `Last week's numbers (vs the week before):\n${facts}\n\nRecent review texts (newest first):\n${reviewTexts.length ? reviewTexts.map((t) => `- ${t}`).join("\n") : "(none)"}`,
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Claude couldn't write the report insights");
  const out = response.parsed_output;
  const tidy = (list: string[], n: number, max: number) => list.map((s) => clip(s.trim(), max)).filter(Boolean).slice(0, n);
  return {
    sentence: clip(out.sentence.trim(), 200),
    praise: tidy(out.praise, 3, 80),
    complaints: tidy(out.complaints, 3, 80),
    actions: out.actions
      .filter((a) => a.title.trim() && a.message.trim())
      .slice(0, 3)
      .map((a) => ({ title: clip(a.title.trim(), 70), why: clip(a.why.trim(), 160), message: clip(a.message.trim(), 300) })),
  };
}

export function rewriteDraft(ctx: RestaurantContext, learning: Learning, draft: Draft, instruction: string) {
  return writeOnly(
    ctx,
    learning,
    `Here is a ${KIND_LABELS[draft.kind].toLowerCase()} draft for ${draft.audience}:\n"""${draft.content}"""\n\nThe owner wants this change: "${instruction}"\n\nRewrite the draft with that change. Keep everything else that was good about it.`,
  );
}
