import "server-only";
import { logAction } from "@/lib/audit";
import { londonYmd } from "@/lib/clock";
import { check, checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { readZReport, type ZImage } from "./ai";
import { addDays, dayLabel } from "./format";
import { saveDayFromZ, saveSalesFile } from "./store";
import {
  alreadySavedLine,
  checkZReport,
  closedOn,
  figuresFrom,
  confirmQuestion,
  dateQuestion,
  needsZNudge,
  nudgeLine,
  replaceQuestion,
  sameFigures,
  savedLine,
  summary,
  UNREADABLE_REPLY,
  type SalesReply,
  type ZFigures,
  type ZRead,
} from "./z-check";

// Till reports ("Z-reports") sent as photos on WhatsApp, by the owner or a staff
// number. The AI reads the numbers, plain code checks they add up (z-check.ts),
// then it's saved with a one-line reply, or the sender is asked to confirm or resend.

// Who sent it, and how to answer them.
export type SalesSender = {
  restaurantId: string;
  number: string; // the sender's WhatsApp number
  role: "owner" | "staff" | "test";
  reply: (text: string) => Promise<unknown>;
};

export type ZRow = ZFigures & {
  id: string;
  restaurant_id: string;
  status: "saved" | "needs_confirm" | "needs_date" | "needs_replace" | "unreadable" | "discarded" | "replaced";
  read: ZRead | null;
  problems: string[];
  photo_path: string | null;
  sent_by: string | null;
  sender_role: "owner" | "staff" | "test";
  is_dummy: boolean;
  saved_at: string | null;
  created_at: string;
};

const PENDING = ["needs_confirm", "needs_date", "needs_replace"];

function figuresOf(row: ZRow): ZFigures {
  return {
    business_date: row.business_date,
    gross_sales: row.gross_sales === null ? null : Number(row.gross_sales),
    net_sales: row.net_sales === null ? null : Number(row.net_sales),
    vat: row.vat === null ? null : Number(row.vat),
    transactions: row.transactions,
    card: row.card === null ? null : Number(row.card),
    cash: row.cash === null ? null : Number(row.cash),
    other_payments: row.other_payments === null ? null : Number(row.other_payments),
    discounts: row.discounts === null ? null : Number(row.discounts),
    refunds: row.refunds === null ? null : Number(row.refunds),
    hourly: row.hourly ?? [],
    net_estimated: row.read ? figuresFrom(row.read).net_estimated : false,
  };
}

function figureColumns(f: ZFigures) {
  const { net_estimated: _estimated, ...columns } = f;
  void _estimated;
  return columns;
}

async function update(row: ZRow, fields: Partial<ZRow>) {
  return checkRow(
    await getSupabase().from("z_reports").update(fields).eq("id", row.id).eq("restaurant_id", row.restaurant_id).select("*").single<ZRow>(),
  );
}

// A photo (or PDF) that might be a till report. Returns false if it isn't one,
// so the owner's food photos can still become Google posts.
export async function receiveZReport(sender: SalesSender, file: { bytes: Buffer; contentType: ZImage["mediaType"] }, note: string, now: Date) {
  const today = londonYmd(now);
  const read = await readZReport({ base64: file.bytes.toString("base64"), mediaType: file.contentType }, today, note);
  const result = checkZReport(read, today);
  if (result.status === "not_report") return false;

  const supabase = getSupabase();
  // A new photo replaces any question still waiting from this sender.
  check(
    await supabase
      .from("z_reports")
      .update({ status: "discarded" })
      .eq("restaurant_id", sender.restaurantId)
      .eq("sent_by", sender.number)
      .in("status", PENDING),
  );
  const ext = file.contentType === "application/pdf" ? "pdf" : file.contentType.split("/")[1].replace("jpeg", "jpg");
  const photoPath = await saveSalesFile(sender.restaurantId, "z-reports", file.bytes, file.contentType, ext);
  const figures = result.figures;
  const status = result.status === "ok" ? "needs_confirm" : result.status;
  const row = checkRow(
    await supabase
      .from("z_reports")
      .insert({
        restaurant_id: sender.restaurantId,
        ...figureColumns(figures),
        photo_path: photoPath,
        media_type: file.contentType,
        read,
        problems: "problems" in result ? result.problems : [],
        status,
        sent_by: sender.number,
        sender_role: sender.role,
        is_dummy: false,
      })
      .select("*")
      .single<ZRow>(),
  );

  if (result.status === "unreadable") await sender.reply(UNREADABLE_REPLY);
  else if (result.status === "needs_date") await sender.reply(dateQuestion(figures, today));
  else if (result.status === "needs_confirm") await sender.reply(confirmQuestion(figures, result.problems, today));
  else await finish(sender, row, today);
  return true;
}

// The numbers are fine (or confirmed): save, unless that day already has a report.
async function finish(sender: SalesSender, row: ZRow, today: string) {
  const f = figuresOf(row);
  const earlier = check(
    await getSupabase()
      .from("z_reports")
      .select("*")
      .eq("restaurant_id", row.restaurant_id)
      .eq("business_date", f.business_date)
      .eq("status", "saved")
      .neq("id", row.id)
      .maybeSingle<ZRow>(),
  );
  if (earlier && sameFigures(figuresOf(earlier), f)) {
    await update(row, { status: "discarded" });
    return sender.reply(alreadySavedLine(f, today));
  }
  if (earlier) {
    await update(row, { status: "needs_replace" });
    return sender.reply(replaceQuestion(f, figuresOf(earlier), today));
  }
  return save(sender, row, today);
}

async function save(sender: SalesSender, row: ZRow, today: string) {
  const saved = await update(row, { status: "saved", saved_at: new Date().toISOString() });
  const f = figuresOf(saved);
  await saveDayFromZ(row.restaurant_id, row.id, f);
  await logAction({
    restaurantId: row.restaurant_id,
    actor: sender.role === "staff" ? "staff" : "owner",
    action: "sales_saved",
    detail: `Till report saved: ${dayLabel(f.business_date!)}, ${summary(f)}${sender.role === "staff" ? ` (sent by staff)` : ""}`,
    data: { z_report_id: row.id, day: f.business_date },
  });
  return sender.reply(savedLine(f, today));
}

// The latest till report still waiting for this sender's answer (from the last day).
export async function pendingZReport(sender: Pick<SalesSender, "restaurantId" | "number">, now: Date) {
  return check(
    await getSupabase()
      .from("z_reports")
      .select("*")
      .eq("restaurant_id", sender.restaurantId)
      .eq("sent_by", sender.number)
      .in("status", PENDING)
      .gte("created_at", new Date(now.getTime() - 24 * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<ZRow>(),
  );
}

// YES / NO / REPLACE / KEEP / a date, for a waiting till report. Returns false
// if the reply doesn't fit the question (so it's treated as normal chat).
export async function answerZReport(sender: SalesSender, row: ZRow, reply: SalesReply, now: Date) {
  const today = londonYmd(now);
  if (row.status === "needs_confirm") {
    if (reply.kind === "yes") return finish(sender, row, today).then(() => true);
    if (reply.kind === "no") {
      await update(row, { status: "discarded" });
      return sender.reply("OK, I didn't save it. Send a clearer photo whenever you're ready. 🧾").then(() => true);
    }
    return false;
  }
  if (row.status === "needs_date") {
    if (reply.kind === "no") {
      await update(row, { status: "discarded" });
      return sender.reply("OK, I didn't save it.").then(() => true);
    }
    if (reply.kind === "yes") return sender.reply(dateQuestion(figuresOf(row), today)).then(() => true);
    if (reply.kind !== "date") return false;
    const read: ZRead = { ...(row.read as ZRead), business_date: reply.ymd };
    const result = checkZReport(read, today);
    if (result.status !== "ok" && result.status !== "needs_confirm") return false;
    const updated = await update(row, { business_date: reply.ymd, read, problems: result.status === "needs_confirm" ? result.problems : [], status: "needs_confirm" });
    if (result.status === "needs_confirm") await sender.reply(confirmQuestion(result.figures, result.problems, today));
    else await finish(sender, updated, today);
    return true;
  }
  if (row.status === "needs_replace") {
    if (reply.kind === "replace" || reply.kind === "yes") {
      check(
        await getSupabase()
          .from("z_reports")
          .update({ status: "replaced" })
          .eq("restaurant_id", row.restaurant_id)
          .eq("business_date", row.business_date)
          .eq("status", "saved"),
      );
      await save(sender, row, today);
      return true;
    }
    if (reply.kind === "keep" || reply.kind === "no") {
      await update(row, { status: "discarded" });
      return sender.reply(`👍 Kept the earlier report for ${dayLabel(row.business_date!)}.`).then(() => true);
    }
  }
  return false;
}

// ---------- Morning brief ----------

// "No till report for yesterday yet": only for restaurants that send till
// reports, when they were open yesterday and have no sales figures for it.
export async function zNudgeFor(r: Pick<Restaurant, "id" | "opening_hours">, now: Date) {
  const today = londonYmd(now);
  const yesterday = addDays(today, -1);
  const supabase = getSupabase();
  const [last, yesterdays] = await Promise.all([
    supabase
      .from("z_reports")
      .select("business_date")
      .eq("restaurant_id", r.id)
      .eq("status", "saved")
      .eq("is_dummy", false)
      .order("business_date", { ascending: false })
      .limit(1)
      .maybeSingle<{ business_date: string }>(),
    supabase.from("sales_days").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).eq("day", yesterday).eq("is_dummy", false),
  ]);
  const lastZDay = check(last)?.business_date ?? null;
  if (yesterdays.error) throw new Error(yesterdays.error.message);
  const nudge = needsZNudge({ lastZDay, yesterdayHasSales: (yesterdays.count ?? 0) > 0, closedYesterday: closedOn(r.opening_hours, yesterday), today });
  return nudge ? nudgeLine(today) : null;
}
