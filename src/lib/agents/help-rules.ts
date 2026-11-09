// "How do I...?" answers from the owner's help guide (agents/help.md) and "your
// setup" (facts from code). The answer's shape, its plain-code rules, the setup
// lines, and the coverage check (every WhatsApp shortcut and onboarding step is in
// the guide). Zod and pure code only (tests/agents/help.test.ts).
import { z } from "zod";
import type { Problems } from "./schema";

export type SetupFacts = {
  google_connected: boolean;
  customers: number;
  emailable_customers: number;
  signup_page: string | null;
  qr_card: string | null;
  qr_pack: string | null;
  signup_reward: string | null;
  discount_cap_percent: number;
  send_window: string;
  paused: boolean;
  sales_days_last_30: number;
  item_sales_last_30: boolean;
  dishes: number;
  dishes_with_costs: number;
  allergens_to_confirm: number;
  staff_phones: number;
  today: string;
};

// "Your setup", one fact a line (what the help answer may say about this restaurant).
export function setupLines(f: SetupFacts): string[] {
  const sales =
    f.sales_days_last_30 === 0
      ? "No sales sent in the last 30 days (no till report, typed takings or sales file)."
      : `Sales for ${f.sales_days_last_30} of the last 30 days${f.item_sales_last_30 ? ", including item-by-item sales" : ", day totals only (no item-by-item sales file yet)"}.`;
  return [
    `Google Business Profile: ${f.google_connected ? "connected" : "not connected yet"}.`,
    `Customers on the list: ${f.customers} (${f.emailable_customers} can receive offers: agreed, confirmed and not unsubscribed).`,
    f.signup_page ? `Customer sign-up page: ${f.signup_page}` : "Customer sign-up page: not set up yet.",
    f.qr_card ? `Printable QR card: ${f.qr_card}` : "",
    f.qr_pack ? `QR pack (table cards, counter sign, poster) as a PDF: ${f.qr_pack}` : "",
    `Sign-up reward: ${f.signup_reward ?? "not set yet"}.`,
    `Biggest discount allowed: ${f.discount_cap_percent}%.`,
    `Customer emails may go out between ${f.send_window}.${f.paused ? " Sending is PAUSED (send RESUME to restart)." : ""}`,
    sales,
    "Direct till connection: not available yet (send exports or till report photos instead).",
    `Menu: ${f.dishes} dishes, ${f.dishes_with_costs} with a cost${f.allergens_to_confirm ? `, ${f.allergens_to_confirm} with allergens still to confirm` : ""}.`,
    `Staff phones that can send sales: ${f.staff_phones}.`,
  ].filter(Boolean);
}

export const HelpOutput = z.object({
  covered: z.boolean().describe("true if the guide (or the setup facts) answers the question; false if it doesn't"),
  message: z
    .string()
    .describe("The WhatsApp reply. covered: the answer. Not covered: one short line saying you'll check with the DinerAI team and come back to them (no guessing)"),
  action: z
    .string()
    .nullable()
    .describe("When DinerAI can do the task itself for the owner: the request the owner would make, in one plain line (e.g. 'Draft an email offer for Thursday'), so a button can start it. Otherwise null"),
});
export type HelpOutputType = z.infer<typeof HelpOutput>;

const EM_DASH = new RegExp(String.fromCharCode(0x2014));
// Internal words that must never reach an owner.
const INTERNAL = /\b(GM|router|composer|Insights agent|Growth agent|Reputation agent|Visibility agent|checker|supabase|schema|prompt|help\.md|agent_\w+)\b/;

export function helpProblems(out: HelpOutputType): Problems {
  const problems: Problems = [];
  const text = out.message.trim();
  if (!text) problems.push("the message is empty");
  if (EM_DASH.test(text)) problems.push("no em-dashes");
  const internal = text.match(INTERNAL);
  if (internal) problems.push(`no internal words ("${internal[0]}"): talk about what the owner sees`);
  if (text.length > 1400) problems.push("too long for WhatsApp: keep it under about 150 words");
  if (!out.covered && out.action) problems.push("an uncovered question can't offer an action");
  if (out.action !== null && !out.action.trim()) problems.push("action is a plain request, or null");
  return problems;
}

// The shortcuts in the WhatsApp HELP text (*APPROVE ALL*, *CAP 25*, *ADD STAFF +44...*):
// the capitalised words at the start of each bold part.
export function helpCommands(helpText: string) {
  const out = new Set<string>();
  for (const m of helpText.matchAll(/\*([^*\n]+)\*/g)) {
    const caps = m[1].match(/^[A-Z]{2,}(?: [A-Z]{2,})*/);
    if (caps) out.add(caps[0]);
  }
  return [...out];
}

// ---------- Topic limits and fallbacks (Part 3) ----------

export const UNANSWERED_REASONS = ["off_topic", "not_in_guide", "blocked", "could_not_help", "router_failed"] as const;
export type UnansweredReason = (typeof UNANSWERED_REASONS)[number];

type Lang = "English" | "Urdu" | "Roman Urdu";

// Off-topic ("how many cows are in the UK?"): a fixed, friendly line back to what helps.
export function offTopicReply(language: Lang, restaurant: string) {
  if (language === "Roman Urdu") return `Yeh mere daaire se bahar hai: main ${restaurant} chalane mein madad ke liye hoon. Reviews, offers, Google posts, sales aur forecast, rota, menu aur profit, ya DinerAI istemaal karne ke baare mein poochiye.`;
  if (language === "Urdu") return `یہ میرے دائرے سے باہر ہے: میں ${restaurant} چلانے میں مدد کے لیے ہوں۔ ریویوز، آفرز، گوگل پوسٹس، سیلز اور فورکاسٹ، روٹا، مینو اور منافع، یا DinerAI کے استعمال کے بارے میں پوچھیں۔`;
  return `That one's outside what I can help with: I'm here to help you run ${restaurant}. Try me on reviews, offers, Google posts, your sales and forecast, the rota, your menu and profit, or how to use DinerAI. For example: "what are three ways to improve my margins?"`;
}

// When nothing could answer (or the reply couldn't be checked): a relevant suggestion, never a bare "couldn't do that".
const SUGGESTIONS: Partial<Record<string, string>> = {
  chat: `Try asking it a little differently, e.g. "which reviews still need a reply?" or "how many customers have we got?"`,
  profile_question: `You can see all your details on the web: *Settings*, then *Your restaurant*. Or ask e.g. "what time do we close on Friday?"`,
  how_to: `I've noted the question. Meanwhile *HELP* lists the shortcuts, and you can ask e.g. "how do I import my customer list?"`,
  advice: `Try asking about one part of the business, e.g. "how can I fill Thursdays?" or "which dishes make me the most?"`,
  insights: `Try one figure at a time, e.g. "how did last week go?" or "how busy will Saturday be?"`,
  growth: `Try telling me the day and the idea, e.g. "Thursday looks quiet, do an offer".`,
  reputation: `Paste the review here, or ask "which reviews still need a reply?"`,
  visibility: `Send me a photo of the dish, or say e.g. "post about our new lamb ribs".`,
};

export function couldNotHelpReply(route: string | null, language: Lang) {
  if (language === "Roman Urdu") return "Maaf kijiye, yeh abhi theek se nahi ho saka. Main ne note kar liya hai. Thore alag tareeqe se poochiye, ya reviews, offers, sales, rota ya details ke baare mein.";
  if (language === "Urdu") return "معاف کیجیے، یہ ابھی ٹھیک سے نہیں ہو سکا۔ میں نے نوٹ کر لیا ہے۔ تھوڑا مختلف پوچھیں، یا ریویوز، آفرز، سیلز، روٹا یا تفصیلات کے بارے میں۔";
  const tip = (route && SUGGESTIONS[route]) ?? `Try saying it another way, e.g. "how did last week go?", "Thursday looks quiet" or "how do I print my QR codes?"`;
  return `Sorry, I couldn't get that one right just now, so I've noted it for the team. ${tip}`;
}

// The guide doesn't cover a product question: the owner hears this; the team is emailed.
export const NOT_IN_GUIDE_SUFFIX = "I've passed it to the DinerAI team, and they'll come back to you.";
