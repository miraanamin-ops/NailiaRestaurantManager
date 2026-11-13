import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { claude, MAX_TOKENS, MODEL, WITH_FALLBACK } from "@/lib/claude";
import { londonLongDate, londonTime, londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { ownerChannel } from "@/lib/followups";
import { signLink } from "@/lib/signed-links";
import { simulatedLabel, simulationOn } from "@/lib/simulation-rules";
import { newToken } from "@/lib/signups";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { clip, noEmDash } from "@/lib/text";
import { daysOf, fallbackWords, monthlyFacts, monthlyFigures, monthlyWhatsApp, monthName, monthPrompt, monthStep, previousMonth, isMonthly, type CalendarDay, type MonthlyReportData, type MonthlyWords } from "./monthly-rules";
import { REPORT_LINK_DAYS } from "./types";
import { benchmarkFacts } from "./benchmark-rules";

// The monthly report (plan: docs/monthly-report.md). The numbers are plain code
// (monthly-rules.ts); Claude writes the headline, one summary sentence and three
// actions from those numbers only, with code's own words if it can't. Saved in the
// reports table like the weekly one (data.kind "monthly"), with a 30-day link and a
// PDF that goes to the owner on WhatsApp (the file itself) and by email.

const DAY = 86_400_000;
const monthStart = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return londonTime(y, m, 1, 0, 0);
};
const nextMonthFirst = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

const WordsSchema = z.object({
  headline: z.string().describe("One short sentence for WhatsApp: the month's net takings and the like for like change on last month. No emojis, no explaining how the comparison works."),
  highlights: z
    .array(z.object({ title: z.string().describe("The message in at most 8 words, with its number"), detail: z.string().describe("One short sentence: the evidence or what it means") }))
    .describe("The 3 or 4 most important things the owner should take from the month, most important first. Each about something different; never repeat a number another highlight or the headline already gives."),
  actions: z
    .array(z.object({ title: z.string().describe("The action in a few words"), why: z.string().describe("Why, from the numbers, in one short sentence"), message: z.string().describe("What the owner would send their WhatsApp assistant to start it") }))
    .describe("Exactly 3 actions for next month"),
});

async function writeWords(r: Restaurant, facts: string, capPercent: number): Promise<MonthlyWords> {
  const response = await claude("monthly-report").beta.messages.parse({
    ...WITH_FALLBACK,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "medium", format: betaZodOutputFormat(WordsSchema) },
    system: `You write the monthly report for the owner of ${r.name}, a ${r.cuisine ?? "restaurant"}. The owner reads it on their phone: plain British English, short, specific, no jargon, no hype, no dashes as punctuation.

The report shows the numbers as charts; your highlights say what they mean. Pick what matters most to running the business (a trend, the shape of the week, a dish, a day that stood out for a real reason, staff cost against target, reviews), not a list of every figure.

Only use the facts you're given. Never invent numbers, dishes or events. Comparisons are "like for like" (adjusted for the month's mix of weekdays): use those. When a day's reason is "No obvious reason", don't make one up.

Actions must be things the owner's WhatsApp assistant can start now: an email campaign with an offer within a ${capPercent}% discount cap, a Google post about a dish, offer or event, a change to the menu or opening hours, replying to reviews, or a staffing change in next month's rotas. Each "message" is written as the owner talking to the assistant, ready to send.`,
    messages: [{ role: "user", content: `The month's numbers:\n${facts}` }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Claude couldn't write the monthly report");
  const out = response.parsed_output;
  const actions = out.actions.filter((a) => a.title.trim() && a.message.trim()).slice(0, 3);
  if (actions.length < 3) throw new Error("Fewer than 3 actions");
  const highlights = out.highlights.filter((h) => h.title.trim()).slice(0, 4);
  if (highlights.length < 3) throw new Error("Fewer than 3 highlights");
  const tidy = (t: string, n: number) => clip(noEmDash(t.trim()), n);
  return {
    headline: tidy(out.headline, 200),
    highlights: highlights.map((h) => ({ title: tidy(h.title, 70), detail: tidy(h.detail, 160) })),
    actions: actions.map((a) => ({ title: tidy(a.title, 70), why: tidy(a.why, 160), message: tidy(a.message, 300) })),
  };
}

export async function monthlyFiguresFor(r: Restaurant, month: string) {
  const supabase = getSupabase();
  const { loadMetricsData } = await import("@/lib/agents/insights");
  const data = await loadMetricsData(r.id, nextMonthFirst(month));
  const days = daysOf(month);
  const calendar = (check(
    await supabase
      .from("local_calendar")
      .select("day, name, type")
      .or(`restaurant_id.is.null,restaurant_id.eq.${r.id}`)
      .gte("day", days[0])
      .lte("day", days.at(-1)!),
  ) ?? []) as CalendarDay[];
  return monthlyFigures({ data, month, calendar });
}

// The report for that month, if it's been made.
export async function findMonthlyReport(restaurantId: string, month: string) {
  const rows =
    (check(await getSupabase().from("reports").select("token, data, created_at, expires_at").eq("restaurant_id", restaurantId).eq("period_start", monthStart(month).toISOString())) as
      | { token: string; data: { kind?: string }; created_at: string; expires_at: string | null }[]
      | null) ?? [];
  return rows.find((x) => x.data?.kind === "monthly") ?? null;
}

// Makes and saves the report. null: the month has no sales figures at all.
export async function createMonthlyReport(r: Restaurant, month: string) {
  const figures = await monthlyFiguresFor(r, month);
  if (!figures) return null;
  const { benchmarkFor } = await import("./benchmark");
  const benchmark = await benchmarkFor(r, month, figures).catch((err) => {
    console.error("Monthly report: nearby comparison failed; left out", err);
    return null;
  });
  const facts = [monthlyFacts(figures, r.name), benchmark ? benchmarkFacts(benchmark) : ""].filter(Boolean).join("\n");
  const words = await writeWords(r, facts, r.discount_cap_percent).catch((err) => {
    console.error("Monthly report words failed; using code's own", err);
    const f = fallbackWords(figures);
    return { headline: f.headline, highlights: f.highlights, actions: f.actions.map((a) => ({ title: a, why: "", message: a })) };
  });
  const data: MonthlyReportData = {
    kind: "monthly",
    version: 2,
    restaurant: { name: r.name, brandColor: r.brand_color ?? "#c8f03c", brandDark: r.brand_dark ?? "#0b0c0a" },
    figures,
    words,
    benchmark,
    whatsappNumber: r.whatsapp_from?.replace(/\D/g, "") || null,
    simulated: simulationOn(r) ? simulatedLabel(londonLongDate(new Date(r.fake_now!))) : null,
  };
  const token = newToken();
  const url = `${appUrl()}/report/${token}`;
  check(
    await getSupabase()
      .from("reports")
      .insert({
        restaurant_id: r.id,
        token,
        period_start: monthStart(month).toISOString(),
        // A second before the next month, so it's never mistaken for that Monday's weekly report.
        period_end: new Date(monthStart(nextMonthFirst(month).slice(0, 7)).getTime() - 1000).toISOString(),
        expires_at: new Date(Date.now() + REPORT_LINK_DAYS * DAY).toISOString(),
        headline: monthlyWhatsApp(data, url),
        data,
      }),
  );
  return { token, url, data };
}

// A link Twilio (and only someone with it) can fetch the PDF from, for 7 days.
export const pdfLink = (token: string) => `${appUrl()}/api/report-pdf/${token}?s=${encodeURIComponent(signLink("report-pdf", token, 7 * DAY))}`;
export const pdfFilename = (d: MonthlyReportData) => `${d.restaurant.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${d.figures.month}-monthly-report.pdf`;

// To the owner: the PDF and the headline on WhatsApp (inside WhatsApp's window), and
// the PDF by email. Returns what went where.
export async function deliverMonthlyReport(r: Restaurant, report: { token: string; url: string; data: MonthlyReportData }, opts: { whatsapp: boolean; email: boolean }) {
  const out: { whatsapp: boolean; email: string } = { whatsapp: false, email: "not sent" };
  const channel = ownerChannel(r);
  if (opts.whatsapp && channel) {
    const { messageOwner } = await import("@/lib/notify");
    await messageOwner(channel, monthlyWhatsApp(report.data, report.url), false, { mediaUrl: pdfLink(report.token), mediaCaption: `${monthName(report.data.figures.month)} report (PDF)`, opener: "report" });
    out.whatsapp = true;
  }
  if (!opts.email) return out;
  try {
    const [{ renderMonthlyPdf }, { sendOwnerEmail }] = await Promise.all([import("./monthly-pdf"), import("@/lib/email")]);
    const pdf = await renderMonthlyPdf(report.data);
    const d = report.data;
    const text = [`Your ${d.figures.label} report for ${d.restaurant.name} is attached as a PDF.`, "", d.words.headline, "", `Read it on your phone: ${report.url}`, "", "Dina, your DinerAI manager"].join("\n");
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5;color:#1c1917"><p>Your ${esc(d.figures.label)} report for ${esc(d.restaurant.name)} is attached as a PDF.</p><p><b>${esc(d.words.headline)}</b></p><p><a href="${report.url}">Read it on your phone</a></p><p>Dina, your DinerAI manager</p></div>`;
    out.email = (await sendOwnerEmail(r, { subject: `${d.restaurant.name}: your ${d.figures.label} report`, text, html, attachments: [{ filename: pdfFilename(d), content: pdf }], kind: "monthly_report" })).delivery;
  } catch (err) {
    console.error("Monthly report email failed", err);
    out.email = "failed";
  }
  return out;
}

const LIVE_DAYS = 45;

// Where this month's report stands for the morning job (see monthStep).
export async function monthStepFor(r: Restaurant, today: string) {
  const supabase = getSupabase();
  const prev = previousMonth(today);
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - LIVE_DAYS * DAY).toISOString().slice(0, 10);
  const [recent, last, report] = await Promise.all([
    supabase.from("sales_days").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).gte("day", since).gt("net_sales", 0),
    supabase.from("sales_days").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).eq("day", daysOf(prev).at(-1)!).gt("net_sales", 0),
    findMonthlyReport(r.id, prev),
  ]);
  if (recent.error) throw recent.error;
  if (last.error) throw last.error;
  return monthStep({ today, reportExists: !!report, lastDayCovered: (last.count ?? 0) > 0, hasSales: (recent.count ?? 0) > 0 });
}

// The morning job's report step: makes last month's report once it's due and emails
// the PDF (email has no 24-hour rule). WhatsApp gets it with the brief.
export async function makeMonthlyIfDue(r: Restaurant, today: string) {
  const step = await monthStepFor(r, today);
  if (step.kind !== "make") return null;
  const report = await createMonthlyReport(r, step.month);
  if (!report) return `monthly report ${step.month}: no figures`;
  const sent = await deliverMonthlyReport(r, report, { whatsapp: false, email: true });
  return `monthly report ${step.month} (email: ${sent.email})`;
}

// For the brief on `day`: the line asking for the month's export (last day of the
// month, then reminders), and the report made that morning, to send on WhatsApp.
export async function monthlyForBrief(r: Restaurant, day: string) {
  const step = await monthStepFor(r, day);
  const extra = step.kind === "ask" || step.kind === "remind" ? [monthPrompt(step, `${appUrl()}/sales?r=${r.id}`)] : [];
  const row = await findMonthlyReport(r.id, previousMonth(day));
  const report =
    row && londonYmd(new Date(row.created_at)) === day && isMonthly(row.data) ? { token: row.token, url: `${appUrl()}/report/${row.token}`, data: row.data } : null;
  return { extra, report };
}
