import "server-only";
import { check, updateDraft, type Draft } from "@/lib/drafts";
import { londonYmd } from "@/lib/clock";
import type { Turn } from "@/lib/bot/turn";
import { getSupabase } from "@/lib/supabase";
import { cancelImport, confirmImport, pendingImport } from "@/lib/sales/pos-import";
import { answerSalesInWords, pendingSalesText, pendingZReport, receiveTypedTakings, type SalesSender, type ZRow } from "@/lib/sales/z-reports";
import { stillOpen, type ConversationLine, type OpenItem, type RouterOutputType } from "./gm-rules";
import { cancelPreview, chooseBasis, confirmImport as confirmCustomerImport, pendingPreview, type CustomerImport } from "@/lib/customer-import";
import { basisQuestion, declarationQuestion } from "@/lib/customer-import/rules";

// Everything Naila asked the owner and is still waiting on, so the GM can tell
// whether a new message answers one of them, corrects it, or is about something
// else. Nothing here answers itself just because it's waiting: the GM decides.
//   "sales"    a day's sales shown back for a yes (typed or from a till photo), a
//              till report with no date, or "replace the day's figures?"
//   "file"     a sales file's columns, waiting for yes or no
//   "question" a question a specialist (Growth, Insights) asked the owner
//   "choice"   "which did you mean?" (context only: the clarified message is routed)
//   "import"   a customer list the owner sent: how they agreed, then the declaration

export type OpenState = {
  items: OpenItem[];
  sales: ZRow | null;
  file: { id: string; mapping: unknown } | null;
  // The specialist's question or the choice card on screen, open or gone stale.
  question: Draft | null;
  choice: Draft | null;
  customerImport: CustomerImport | null;
};

const minutesSince = (iso: string, now: Date) => Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));

export async function openItemsFor(turn: Turn, active: Draft | null): Promise<OpenState> {
  const now = turn.ctx.now;
  const realNow = new Date();
  const [z, pos, preview] = await Promise.all([
    pendingZReport({ restaurantId: turn.ctx.restaurantId, number: turn.owner }, now).catch(() => null),
    pendingImport(turn.ctx.restaurantId, now).catch(() => null),
    pendingPreview(turn.ctx.restaurantId).catch(() => null),
  ]);
  const items: OpenItem[] = [];
  const sales = z && stillOpen(z.status === "needs_date" ? "sales_date" : z.status === "needs_replace" ? "sales_replace" : "sales_confirm", z.created_at, realNow) ? z : null;
  if (sales) {
    const kind = sales.status === "needs_date" ? "sales_date" : sales.status === "needs_replace" ? "sales_replace" : "sales_confirm";
    items.push({ ref: "sales", kind, asks: pendingSalesText(sales, londonYmd(now)), minutes_ago: minutesSince(sales.created_at, realNow) });
  }
  const file = pos && pos.mapping && stillOpen("file_layout", pos.created_at, realNow) ? { id: pos.id, mapping: pos.mapping } : null;
  if (file && pos) items.push({ ref: "file", kind: "file_layout", asks: "A sales file sent in the app has a new column layout: import it with the columns shown?", minutes_ago: minutesSince(pos.created_at, realNow) });

  const customerImport = preview && stillOpen("customer_import", preview.created_at, realNow) ? preview : null;
  if (customerImport) {
    const n = customerImport.rows_to_add.toLocaleString("en-GB");
    items.push({
      ref: "import",
      kind: "customer_import",
      asks: customerImport.basis
        ? `The owner said these ${n} people ${customerImport.basis === "opted_in" ? "opted in" : "are past customers given a chance to opt out"}. Waiting for YES to the declaration (or to be told they should confirm their email first).`
        : `A customer list of ${n} new people: how did they agree to hear from the restaurant? (opted in / past customers given a chance to opt out / not sure)`,
      minutes_ago: minutesSince(customerImport.created_at, realNow),
    });
  }
  const waiting = active?.waiting_for === "decision" ? active : null;
  const question = waiting?.kind === "agent_question" ? waiting : null;
  const choice = waiting?.kind === "choice" ? waiting : null;
  // A question shown in the morning brief counts from when the owner saw it.
  const since = (d: Draft) => (d as Draft & { briefed_at?: string | null }).briefed_at ?? d.created_at;
  if (question && stillOpen("agent_question", since(question), realNow)) {
    const from = (question as Draft & { agent_input?: { agent?: string } }).agent_input?.agent ?? "a specialist";
    items.push({ ref: "question", kind: "agent_question", asks: `${from[0].toUpperCase()}${from.slice(1)} asked: ${question.content}`, minutes_ago: minutesSince(since(question), realNow) });
  }
  if (choice && stillOpen("choice", choice.created_at, realNow)) {
    items.push({ ref: "choice", kind: "choice", asks: `${choice.content} (about the owner's message: "${(choice.request ?? "").slice(0, 200)}")`, minutes_ago: minutesSince(choice.created_at, realNow) });
  }
  return { items, sales, file, question, choice, customerImport };
}

// The owner moved on (the GM routed their message somewhere else): a specialist's
// question or a "which did you mean?" stops waiting, so it can't catch a later
// message by mistake. Sales questions stay (a yes later still saves the figure).
export async function closeStaleQuestions(open: OpenState) {
  for (const d of [open.question, open.choice]) {
    if (d) await updateDraft(d.id, { status: "superseded", waiting_for: null }).catch((err) => console.error("Couldn't close a waiting question", err));
  }
}

const FIGURE_NOT_USABLE = "I couldn't use that figure: it needs to be for a day that's happened, between £1 and £500,000. What was the day and the amount?";

// answer_open on "sales" or "file", and sales_entry. false: not one of these (the caller carries on).
export async function handleSalesRoute(turn: Turn, routed: RouterOutputType, open: OpenState): Promise<boolean> {
  const sender: SalesSender = { restaurantId: turn.ctx.restaurantId, number: turn.owner, role: "owner", reply: (text) => turn.send(text) };
  if (routed.route === "answer_open" && routed.open_item === "sales" && open.sales) {
    const done = await answerSalesInWords(sender, open.sales, { decision: routed.decision, change: routed.sales }, turn.ctx.now);
    if (!done) await turn.send(routed.sales ? FIGURE_NOT_USABLE : "Should I save it? A yes saves it; or tell me what's different.");
    return true;
  }
  if (routed.route === "answer_open" && routed.open_item === "import" && open.customerImport) {
    await answerImport(turn, routed, open.customerImport);
    return true;
  }
  if (routed.route === "answer_open" && routed.open_item === "file" && open.file) {
    if (routed.decision === "yes") {
      const outcome = await confirmImport(turn.ctx.restaurantId, open.file.id, open.file.mapping as Parameters<typeof confirmImport>[2], "owner");
      await turn.send(outcome.message);
    } else if (routed.decision === "no") {
      await cancelImport(turn.ctx.restaurantId, open.file.id);
      await turn.send("OK, I didn't import that file.");
    } else {
      await turn.send("Shall I import that file with those columns? A yes imports it, a no leaves it.");
    }
    return true;
  }
  if (routed.route === "sales_entry" && routed.sales?.amount != null) {
    const s = routed.sales;
    const today = londonYmd(turn.ctx.now);
    const typed = { business_date: s.business_date ?? today, amount: Math.round(s.amount! * 100) / 100, basis: s.basis ?? ("gross" as const), transactions: s.transactions };
    const shown = typed.business_date <= today && (await receiveTypedTakings(sender, typed, turn.ctx.now));
    if (!shown) await turn.send(FIGURE_NOT_USABLE);
    return true;
  }
  return false;
}

// Restaurants not on the GM yet: when a sales question or a file layout is waiting,
// the same understanding reads the owner's reply ("before VAT", "no, Saturday"), so
// nobody has to use special words. Anything else carries on as before (false).
export async function salesAnswerWithoutGm(turn: Turn, body: string, active: Draft | null) {
  const open = await openItemsFor(turn, null);
  if (!open.sales && !open.file && !open.customerImport) return false;
  const { routeMessage } = await import("./gm");
  const routed = await routeMessage(turn.ctx.restaurantId, turn.owner, body, active, { open: open.items, today: londonYmd(turn.ctx.now) });
  if (!routed || !["answer_open", "sales_entry"].includes(routed.output.route)) return false;
  return handleSalesRoute(turn, routed.output, open);
}

// The owner's answers about a customer list they sent: how these people agreed (any
// words), then YES to the declaration; "not sure" can't be imported (and says why).
async function answerImport(turn: Turn, routed: RouterOutputType, imp: CustomerImport) {
  const r = turn.ctx.restaurant;
  if (routed.import_basis && routed.import_basis !== imp.basis) {
    const chosen = await chooseBasis(r, imp, routed.import_basis);
    if (chosen.accepted && routed.double_opt_in) await setDoubleOptIn(r.id, imp.id, true);
    return turn.send(chosen.text);
  }
  if (!imp.basis) return turn.send(basisQuestion());
  if (routed.decision === "no") {
    await cancelPreview(r.id, imp.id);
    return turn.send("OK, I didn't import that list. Send it again whenever you're ready.");
  }
  const doubleOptIn = routed.double_opt_in ?? imp.double_opt_in;
  if (routed.decision !== "yes") {
    if (routed.double_opt_in !== null && routed.double_opt_in !== undefined) await setDoubleOptIn(r.id, imp.id, routed.double_opt_in);
    return turn.send(`${routed.double_opt_in ? "Got it: each one will be asked to confirm their email first, and only those who do are added to your offers. " : ""}${declarationQuestion(imp.basis, r.name, imp.rows_to_add)}`);
  }
  const result = await confirmCustomerImport({ restaurant: r, importId: imp.id, basis: imp.basis, declaredBy: turn.owner, doubleOptIn });
  if (!result.ok) return turn.send(result.text);
  const { draftMessage } = await import("@/lib/format");
  await turn.send(`✅ Added ${result.added.toLocaleString("en-GB")} customer${result.added === 1 ? "" : "s"} to your list. Nobody has been emailed yet: here's the first message they'd get, for you to approve.`);
  return turn.send(draftMessage(result.draft, r), true);
}

async function setDoubleOptIn(restaurantId: string, importId: string, on: boolean) {
  check(await getSupabase().from("customer_imports").update({ double_opt_in: on }).eq("restaurant_id", restaurantId).eq("id", importId));
}

// The conversation before the newest message, oldest first (what every agent reads).
export async function recentConversation(restaurantId: string, owner: string, limit = 12): Promise<ConversationLine[]> {
  const rows =
    check(
      await getSupabase()
        .from("messages")
        .select("direction, body")
        .eq("restaurant_id", restaurantId)
        .or(`from_number.eq."${owner}",to_number.eq."${owner}"`)
        .order("created_at", { ascending: false })
        .limit(limit + 1)
        .returns<{ direction: string; body: string | null }[]>(),
    ) ?? [];
  // The newest is the message being handled.
  return rows
    .slice(1)
    .reverse()
    .filter((m) => m.body?.trim())
    .map((m) => ({ from: m.direction === "inbound" ? ("owner" as const) : ("naila" as const), text: (m.body ?? "").slice(0, 600) }));
}
