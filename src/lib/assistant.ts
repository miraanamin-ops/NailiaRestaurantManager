import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase, restaurantNow, type Customer, type Restaurant, type Review } from "@/lib/supabase";
import { DRAFT_KINDS, KIND_LABELS, type Draft, type DraftKind, type getLearningContext } from "@/lib/drafts";

const MODEL = "claude-sonnet-5";
// Drafts must fit in a WhatsApp button message (1024 chars) with a header.
const DRAFT_MAX_CHARS = 700;
const CHAT_MAX_CHARS = 1600;

export type StoredMessage = {
  direction: "inbound" | "outbound";
  body: string;
  status: string;
};

type Learning = Awaited<ReturnType<typeof getLearningContext>>;

function londonDate(d: Date) {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

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
        result.push({ name: c.name, date: londonDate(day) });
      }
    }
  }
  return result;
}

// Loads the restaurant, its customers and reviews from the database and
// turns them into the background knowledge Claude gets on every message.
export async function loadRestaurantContext() {
  const supabase = getSupabase();
  const { data: restaurant, error } = await supabase
    .from("restaurants")
    .select("*")
    .limit(1)
    .maybeSingle<Restaurant>();
  if (error) throw error;
  if (!restaurant) throw new Error("No restaurant in the database");

  const [customersRes, reviewsRes] = await Promise.all([
    supabase.from("customers").select("*").eq("restaurant_id", restaurant.id).order("name").returns<Customer[]>(),
    supabase.from("reviews").select("*").eq("restaurant_id", restaurant.id).order("review_date", { ascending: false }).returns<Review[]>(),
  ]);
  if (customersRes.error) throw customersRes.error;
  if (reviewsRes.error) throw reviewsRes.error;

  const customers = customersRes.data ?? [];
  const reviews = reviewsRes.data ?? [];
  const today = restaurantNow(restaurant);
  const avg = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : "n/a";

  const data = {
    restaurant: {
      name: restaurant.name,
      cuisine: restaurant.cuisine,
      address: restaurant.address,
      phone: restaurant.phone,
      opening_hours: restaurant.opening_hours,
      menu: restaurant.menu,
      brand_voice: restaurant.brand_voice,
      signup_reward: restaurant.signup_reward,
    },
    review_summary: { count: reviews.length, average_rating: avg, not_replied: reviews.filter((r) => !r.replied).length },
    reviews: reviews.map((r) => ({
      id: r.id,
      author: r.author_name,
      rating: r.rating,
      text: r.text,
      date: r.review_date.slice(0, 10),
      replied: r.replied,
    })),
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      whatsapp: c.phone,
      birthday: c.birthday,
      visits: c.visit_count,
      last_visit: c.last_visit,
      marketing_opt_in: c.marketing_opt_in,
      notes: c.notes,
    })),
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
    today: londonDate(today),
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
type Mode = "chat" | "write";

const CHAT_INSTRUCTIONS = `Chatting with the owner:
- This is WhatsApp. Keep replies short and easy to read on a phone, ideally under 120 words.
- Use WhatsApp formatting only: *bold*, _italic_, and simple "- " bullet lists. No markdown headings, tables or links.
- Talk to the owner like a helpful, friendly colleague.
- Whenever the owner asks you to write something meant for customers or the public (a review reply, an offer or promotion, a birthday message, an announcement), call the create_draft tool instead of writing it in chat. The owner then approves, edits or skips it.`;

const WRITE_INSTRUCTIONS = `You are writing one draft right now. Reply with only the finished message text, exactly as it would be sent: no intro, no explanation, no quotes around it, no JSON or code.`;

function systemPrompt(ctx: RestaurantContext, learning: Learning, activeDraft: Draft | null, mode: Mode): Anthropic.TextBlockParam[] {
  const background = `You are Naila, a WhatsApp marketing assistant for the owner of ${ctx.restaurantName}. You work for the restaurant owner (not for customers).

You help the owner understand how the restaurant is doing and grow it: summarise and analyse reviews, spot patterns, know the regular customers and upcoming birthdays, suggest simple marketing ideas, and write drafts of customer-facing messages for them to approve.

Base every fact on the restaurant data below. If something isn't in the data, say you don't have it rather than guessing.

Writing drafts (review replies, offers, birthday messages, announcements):
- Write in the restaurant's brand voice, ready to send as-is: no placeholders like [Name], under ${DRAFT_MAX_CHARS} characters.
- Use real details from the data: customer first names, menu items, prices and opening hours. Offers are suggestions for the owner to approve, so you can propose a concrete deal.
- Don't offer freebies, refunds or other promises unless the owner asks for them.
- Nothing is sent to customers yet; approved drafts are only logged.

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

  const modeText = mode === "chat" ? [CHAT_INSTRUCTIONS, active] : [WRITE_INSTRUCTIONS];

  return [
    // The big background block is the same in both modes and rarely changes,
    // so cache it to make replies faster and cheaper.
    { type: "text", text: background, cache_control: { type: "ephemeral" } },
    { type: "text", text: [today, learningText(learning), ...modeText].join("\n\n") },
  ];
}

const createDraftTool: Anthropic.Tool = {
  name: "create_draft",
  description:
    "Save a new draft message for the owner to approve. Use for anything meant for customers or the public: review replies, offers, birthday messages, announcements.",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...DRAFT_KINDS], description: "Type of draft" },
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

const reviseDraftTool: Anthropic.Tool = {
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

// Turns stored WhatsApp messages (oldest first) into a Claude conversation.
function toClaudeMessages(history: StoredMessage[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = history
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

function textOf(response: Anthropic.Message) {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function clip(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
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
  | { type: "revise"; instruction: string; content: string };

// A normal WhatsApp message from the owner: answer it, or produce a draft.
export async function chat(
  ctx: RestaurantContext,
  learning: Learning,
  activeDraft: Draft | null,
  history: StoredMessage[],
): Promise<ChatResult> {
  const messages = toClaudeMessages(history);
  if (!messages.length) return { type: "text", text: "Hi! 👋 Send me a question about the restaurant and I'll help." };

  const tools = activeDraft?.waiting_for === "decision" ? [createDraftTool, reviseDraftTool] : [createDraftTool];
  const response = await new Anthropic().messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" }, // quick chat replies keep WhatsApp responsive
    system: systemPrompt(ctx, learning, activeDraft, "chat"),
    tools,
    messages,
  });

  if (response.stop_reason === "refusal") {
    return { type: "text", text: "Sorry, I can't help with that one. Try asking me something else about the restaurant." };
  }

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
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
  const response = await new Anthropic().messages.create({
    model: MODEL,
    max_tokens: 4000,
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

export function writeReviewReply(ctx: RestaurantContext, learning: Learning, review: Review) {
  return writeOnly(
    ctx,
    learning,
    `A new ${review.rating}-star Google review just came in from ${review.author_name}:\n"""${review.text}"""\n\nWrite the restaurant's public reply to this review.`,
  );
}

export function rewriteDraft(ctx: RestaurantContext, learning: Learning, draft: Draft, instruction: string) {
  return writeOnly(
    ctx,
    learning,
    `Here is a ${KIND_LABELS[draft.kind].toLowerCase()} draft for ${draft.audience}:\n"""${draft.content}"""\n\nThe owner wants this change: "${instruction}"\n\nRewrite the draft with that change. Keep everything else that was good about it.`,
  );
}
