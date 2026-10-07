import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase, type Customer, type Restaurant, type Review } from "@/lib/supabase";

const MODEL = "claude-sonnet-5";
// WhatsApp rejects messages over 1600 characters.
const WHATSAPP_MAX_CHARS = 1600;

export type StoredMessage = {
  direction: "inbound" | "outbound";
  body: string;
  status: string;
};

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
  const today = new Date();
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
    },
    review_summary: { count: reviews.length, average_rating: avg, not_replied: reviews.filter((r) => !r.replied).length },
    reviews: reviews.map((r) => ({
      author: r.author_name,
      rating: r.rating,
      text: r.text,
      date: r.review_date.slice(0, 10),
      replied: r.replied,
    })),
    customers: customers.map((c) => ({
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
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    data,
    today: londonDate(today),
    birthdaysThisWeek: upcomingBirthdays(customers, today),
  };
}

type RestaurantContext = Awaited<ReturnType<typeof loadRestaurantContext>>;

function systemPrompt(ctx: RestaurantContext): Anthropic.TextBlockParam[] {
  const instructions = `You are Naila, a WhatsApp marketing assistant for the owner of ${ctx.restaurantName}. You are chatting with the restaurant owner (not with customers).

You help the owner understand how the restaurant is doing and grow it: summarise and analyse reviews, spot patterns, know the regular customers and upcoming birthdays, suggest simple marketing ideas, and draft review replies or customer messages in the restaurant's brand voice when asked.

How to reply:
- This is WhatsApp. Keep replies short and easy to read on a phone, ideally under 120 words and never more than 1,200 characters.
- Use WhatsApp formatting only: *bold*, _italic_, and simple "- " bullet lists. No markdown headings, tables or links.
- Talk to the owner like a helpful, friendly colleague. When you draft something for customers, write it in the brand voice below.
- Base every fact on the restaurant data below. If something isn't in the data, say you don't have it rather than guessing.
- You can't send messages to customers or post review replies yet. If asked, write a draft and say it's ready for them to copy.

Restaurant data (JSON):
${JSON.stringify(ctx.data, null, 2)}`;

  const today = `Today is ${ctx.today} (London time). Customer birthdays in the next 7 days: ${
    ctx.birthdaysThisWeek.length
      ? ctx.birthdaysThisWeek.map((b) => `${b.name} (${b.date})`).join(", ")
      : "none"
  }.`;

  return [
    // The big data block is the same on every message, so cache it to make replies faster and cheaper.
    { type: "text", text: instructions, cache_control: { type: "ephemeral" } },
    { type: "text", text: today },
  ];
}

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

export async function generateReply(ctx: RestaurantContext, history: StoredMessage[]) {
  const messages = toClaudeMessages(history);
  if (!messages.length) return "Hi! 👋 Send me a question about the restaurant and I'll help.";

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" }, // quick chat replies; keeps WhatsApp responses fast
    system: systemPrompt(ctx),
    messages,
  });

  if (response.stop_reason === "refusal") {
    return "Sorry, I can't help with that one. Try asking me something else about the restaurant.";
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) return "Sorry, I couldn't come up with an answer. Could you rephrase that?";
  return text.length > WHATSAPP_MAX_CHARS ? text.slice(0, WHATSAPP_MAX_CHARS - 1) + "…" : text;
}
