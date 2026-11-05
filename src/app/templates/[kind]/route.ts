import type { NextRequest } from "next/server";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { verifyLink } from "@/lib/signed-links";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { TEMPLATE_KINDS, templatePurpose } from "@/lib/templates/links";
import { dailyTakingsSpec, menuCostsSpec, salesExampleSpec, staffSpec, type TemplateKind } from "@/lib/templates/specs";
import { buildWorkbook } from "@/lib/templates/workbook";

// An owner's spreadsheet, made fresh each time (the menu costs sheet with their
// current menu and costs). Signed links only (lib/templates/links.ts).
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const rid = req.nextUrl.searchParams.get("r") ?? "";
  if (!(TEMPLATE_KINDS as string[]).includes(kind)) return new Response("Not found", { status: 404 });
  if (!verifyLink(templatePurpose(kind as TemplateKind), rid, req.nextUrl.searchParams.get("t"))) {
    return new Response("This download link has expired. Ask me on WhatsApp for a new one, or download it from your settings page.", { status: 403 });
  }
  const r = check(await getSupabase().from("restaurants").select("id, name, brand_color, menu").eq("id", rid).maybeSingle<Pick<Restaurant, "id" | "name" | "brand_color" | "menu">>());
  if (!r) return new Response("Not found", { status: 404 });
  const spec =
    kind === "menu_costs" ? menuCostsSpec({ name: r.name, brand_color: r.brand_color, menu: r.menu }) : kind === "staff" ? staffSpec(r) : kind === "sales_example" ? salesExampleSpec() : dailyTakingsSpec(r, londonYmd(new Date()));
  const body = await buildWorkbook(spec);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${spec.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
