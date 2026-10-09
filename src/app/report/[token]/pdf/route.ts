import type { NextRequest } from "next/server";
import { getReportByToken } from "@/lib/report/build";
import { renderReportPdf } from "@/lib/report/pdf";

// "Download PDF" on the report page: the same snapshot, as a branded A4 PDF.
export async function GET(_req: NextRequest, ctx: RouteContext<"/report/[token]/pdf">) {
  const { token } = await ctx.params;
  const report = await getReportByToken(token);
  if (!report) return new Response("Report not found", { status: 404 });

  const pdf = await renderReportPdf(report.data);
  const slug = report.data.restaurant.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const date = report.data.period.end.slice(0, 10);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${slug}-weekly-report-${date}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
