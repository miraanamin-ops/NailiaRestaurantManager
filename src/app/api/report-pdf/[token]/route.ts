import { verifyLink } from "@/lib/signed-links";
import { getReportByToken } from "@/lib/report/build";
import { pdfFilename } from "@/lib/report/monthly";
import { renderMonthlyPdf } from "@/lib/report/monthly-pdf";
import { isMonthly } from "@/lib/report/monthly-rules";

// The monthly report's PDF for WhatsApp: Twilio fetches it from here, so it can't
// need a login. Only with a signed link (lib/report/monthly.ts pdfLink, 7 days).
export async function GET(req: Request, ctx: RouteContext<"/api/report-pdf/[token]">) {
  const { token } = await ctx.params;
  if (!verifyLink("report-pdf", token, new URL(req.url).searchParams.get("s"))) return new Response("This link has expired.", { status: 410 });
  const report = await getReportByToken(token);
  const data: unknown = report?.data;
  if (!report || !isMonthly(data)) return new Response("Report not found", { status: 404 });
  const pdf = await renderMonthlyPdf(data);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdfFilename(data)}"`, "Cache-Control": "private, no-store" },
  });
}
