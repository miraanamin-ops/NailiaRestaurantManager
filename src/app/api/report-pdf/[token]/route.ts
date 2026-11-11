import { verifyLink } from "@/lib/signed-links";
import { getReportByToken } from "@/lib/report/build";
import { pdfFilename } from "@/lib/report/monthly";
import { renderMonthlyPdf } from "@/lib/report/monthly-pdf";
import { isMonthly } from "@/lib/report/monthly-rules";

// A report's PDF from a signed link, with no login: the monthly report for WhatsApp
// (Twilio fetches it; lib/report/monthly.ts pdfLink, 7 days), and any report for the
// app's Share PDF (lib/app/more.ts reportFor, 1 day).
export async function GET(req: Request, ctx: RouteContext<"/api/report-pdf/[token]">) {
  const { token } = await ctx.params;
  if (!verifyLink("report-pdf", token, new URL(req.url).searchParams.get("s"))) return new Response("This link has expired.", { status: 410 });
  const report = await getReportByToken(token);
  const data: unknown = report?.data;
  if (!report) return new Response("Report not found", { status: 404 });
  if (isMonthly(data)) {
    const pdf = await renderMonthlyPdf(data);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdfFilename(data)}"`, "Cache-Control": "private, no-store" },
    });
  }
  // A weekly report (the app's Share PDF, a one-day signed link from /api/app/reports/[token]).
  const { renderReportPdf } = await import("@/lib/report/pdf");
  const pdf = await renderReportPdf(report.data);
  const slug = report.data.restaurant.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${slug}-weekly-report-${report.data.period.end.slice(0, 10)}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
