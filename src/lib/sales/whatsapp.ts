import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { ownerChannel } from "@/lib/followups";
import { messageOwner } from "@/lib/notify";
import { downloadTwilioMedia } from "@/lib/photos";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import type { ZImage } from "./ai";
import { isSpreadsheetType } from "./pos-file";
import { cancelImport, confirmImport, pendingImport, receivePosFile } from "./pos-import";
import { parseSalesReply } from "./z-check";
import { answerZReport, pendingZReport, receiveZReport, type SalesSender } from "./z-reports";

// Sales on WhatsApp: till report photos and POS files from the owner or a
// staff number, and their answers (YES, REPLACE, a date...).

const Z_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
// A question only waits this long for its answer; after that, "yes" is just chat.
const ANSWER_WINDOW_MS = 6 * 3600_000;

export type IncomingFile = { url?: string; bytes?: Buffer; contentType: string };

async function bytesOf(file: IncomingFile) {
  if (file.bytes) return file.bytes;
  return downloadTwilioMedia(file.url!);
}

// A photo, PDF or spreadsheet sent on WhatsApp.
//   "handled":     it was a till report or sales file (the sender has had their answer)
//   "not_report":  a photo that isn't a till report (the owner's becomes a Google post)
//   "unsupported": neither
export async function salesFromMedia(sender: SalesSender, file: IncomingFile, note: string, now: Date): Promise<"handled" | "not_report" | "unsupported"> {
  const type = file.contentType.toLowerCase().split(";")[0].trim();
  if (Z_TYPES.includes(type)) {
    const bytes = await bytesOf(file);
    return (await receiveZReport(sender, { bytes, contentType: type as ZImage["mediaType"] }, note, now)) ? "handled" : "not_report";
  }
  if (!type.startsWith("image/") && isSpreadsheetType(type)) {
    const bytes = await bytesOf(file);
    const outcome = await receivePosFile({
      restaurantId: sender.restaurantId,
      bytes,
      contentType: type,
      channel: "whatsapp",
      sentBy: sender.number,
      actor: sender.role === "staff" ? "staff" : "owner",
    });
    if (outcome.status === "needs_mapping" && sender.role === "staff") {
      // Only the owner can confirm a new layout: ask them, and tell the staff member.
      const r = await restaurantFor(sender.restaurantId);
      const channel = r && ownerChannel(r);
      if (channel) await messageOwner(channel, `👥 Your staff (${sender.number.replace(/^whatsapp:/, "")}) sent a sales file.\n\n${outcome.message}`);
      await sender.reply("📊 Thanks! That's a new file layout, so I've asked the owner to check the columns once. After that, files like it import straight away.");
    } else {
      await sender.reply(outcome.message);
    }
    return "handled";
  }
  return "unsupported";
}

async function restaurantFor(id: string) {
  return check(await getSupabase().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
}

// An answer to a sales question (a till report to confirm, or a new file layout).
// false: not an answer, carry on as normal chat.
export async function salesReply(sender: SalesSender, body: string, now: Date) {
  const reply = parseSalesReply(body, londonYmd(now));
  if (!reply) return false;
  const since = now.getTime() - ANSWER_WINDOW_MS;
  const z = await pendingZReport(sender, now);
  // Only the owner confirms file layouts (staff files are asked about on the owner's phone).
  const pos = sender.role === "staff" ? null : await pendingImport(sender.restaurantId, now);
  const fresh = <T extends { created_at: string }>(x: T | null) => (x && new Date(x.created_at).getTime() >= since ? x : null);
  const [zq, pq] = [fresh(z), fresh(pos)];
  if (zq && (!pq || zq.created_at >= pq.created_at)) return answerZReport(sender, zq, reply, now);
  if (!pq) return false;
  if (reply.kind === "yes") {
    const outcome = await confirmImport(sender.restaurantId, pq.id, pq.mapping!, "owner");
    await sender.reply(outcome.message);
    return true;
  }
  if (reply.kind === "no") {
    await cancelImport(sender.restaurantId, pq.id);
    await sender.reply("OK, I didn't import that file.");
    return true;
  }
  return false;
}

const staffHelp = (name: string) =>
  `👋 This number can send *till report photos* and *sales files* (CSV or Excel) for ${name}. Just send the photo or file here.`;

// Everything a staff number sends. They can send data and answer questions about it, nothing else.
export async function handleStaffMessage(input: {
  restaurantId: string;
  staffNumber: string;
  sandbox: string;
  body: string;
  media: { url: string; contentType: string } | null;
}) {
  const channel = { restaurantId: input.restaurantId, from: input.sandbox, to: input.staffNumber };
  const reply = (text: string) => messageOwner(channel, text);
  const sender: SalesSender = { restaurantId: input.restaurantId, number: input.staffNumber, role: "staff", reply };
  const now = new Date();
  try {
    const r = await restaurantFor(input.restaurantId);
    if (!r) return;
    if (input.media) {
      const outcome = await salesFromMedia(sender, input.media, input.body, now);
      if (outcome === "not_report") await reply(`That doesn't look like a till report. ${staffHelp(r.name)}`);
      if (outcome === "unsupported") await reply(staffHelp(r.name));
      return;
    }
    if (await salesReply(sender, input.body, now)) return;
    await reply(staffHelp(r.name));
  } catch (err) {
    console.error("Failed to handle a staff message", err);
    await reply("Sorry, something went wrong on my side. Please try again in a minute. 🙏");
  }
}
