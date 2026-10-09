import { NextResponse, type NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { getReportByToken } from "@/lib/report/build";
import { renderReportPdf } from "@/lib/report/pdf";
import { reportExpired } from "@/lib/report/types";

// "Download PDF" on the report page: the same snapshot, as a branded A4 PDF.
// Same rules as the page: logged in, the right restaurant, and not expired.
export async function GET(req: NextRequest, ctx: RouteContext<"/report/[token]/pdf">) {
  const { token } = await ctx.params;
  const owner = await currentOwner();
  if (!owner) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/report/${token}`)}`, req.url));
  const report = await getReportByToken(token);
  if (!report || !owner.restaurantIds.includes(report.restaurant_id)) return new Response("Report not found", { status: 404 });
  if (reportExpired(report.expires_at, new Date())) return new Response("This report link has expired.", { status: 410 });

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
