import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { messageOwner } from "@/lib/notify";
import { addDays, gbp } from "@/lib/sales/format";
import { weatherReport } from "@/lib/sales/weather";
import { salesFromMedia } from "@/lib/sales/whatsapp";
import type { SalesSender } from "@/lib/sales/z-reports";
import { appUrl, getSupabase } from "@/lib/supabase";
import type { ZSample } from "./parse";
import type { Turn } from "./turn";

// SALES, SAMPLE ZREPORT, TEST ZREPORT and RUN WEATHER. (ADD STAFF etc. are in lib/sales/staff.ts.)

export function ownerSender(turn: Turn, role: SalesSender["role"] = "owner"): SalesSender {
  return { restaurantId: turn.ctx.restaurantId, number: turn.owner, role, reply: (text) => turn.send(text) };
}

export function sampleUrl(sample: ZSample) {
  return `${appUrl()}/samples/z-report-${sample}.jpg`;
}

// SALES: the last 7 days in one line, and the page to upload files and see till reports.
export async function salesCommand(turn: Turn) {
  const r = turn.ctx.restaurant;
  const today = londonYmd(turn.ctx.now);
  const rows =
    check(
      await getSupabase()
        .from("sales_days")
        .select("net_sales")
        .eq("restaurant_id", r.id)
        .gte("day", addDays(today, -7))
        .lt("day", today)
        .returns<{ net_sales: number }[]>(),
    ) ?? [];
  const total = rows.reduce((s, d) => s + Number(d.net_sales), 0);
  const line = rows.length
    ? `📊 *Last 7 days:* ${gbp(total)} net, from ${rows.length} day${rows.length === 1 ? "" : "s"} with figures.`
    : "📊 No sales figures for the last 7 days yet.";
  return turn.send(
    `${line}\n🧾 Send a photo of your end-of-day till report here any time.\n📁 Upload a POS export (CSV or Excel) or send the file here: ${appUrl()}/sales?r=${r.id}`,
  );
}

// SAMPLE ZREPORT 2: sends a sample till report photo to forward back.
export async function sampleZCommand(turn: Turn, sample: ZSample) {
  const url = sampleUrl(sample);
  if (!url.startsWith("https://")) {
    return turn.send(`WhatsApp can only send pictures from a public https address, and this server is at ${appUrl()}. Try *TEST ZREPORT ${sample.toUpperCase()}* instead.`);
  }
  const caption =
    sample === "bad"
      ? "🧾 A blurry, cut-off sample till report. Forward it back to me (or save it and send it) to see what happens."
      : `🧾 Sample till report ${sample}. Forward it back to me (or save it and send it) to test. *TEST ZREPORT ${sample}* does it in one go.`;
  return messageOwner(turn.channel, "", false, { mediaUrl: url, mediaCaption: caption });
}

// TEST ZREPORT 2: as if the owner had just sent sample 2.
export async function testZCommand(turn: Turn, sample: ZSample) {
  const res = await fetch(sampleUrl(sample), { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return turn.send(`Couldn't load the sample till report (${res.status}) from ${sampleUrl(sample)}.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await turn.send(`🧪 Pretending you just sent sample till report ${sample}…`);
  const outcome = await salesFromMedia(ownerSender(turn, "test"), { bytes, contentType: "image/jpeg" }, "", turn.ctx.now);
  if (outcome !== "handled") await turn.send("Hmm, I didn't recognise that as a till report.");
}

export async function runWeatherCommand(turn: Turn) {
  return turn.send(await weatherReport(turn.ctx.restaurant, turn.ctx.now));
}
