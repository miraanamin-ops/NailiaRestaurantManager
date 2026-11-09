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
