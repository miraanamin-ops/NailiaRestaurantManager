import type { NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { exportCustomers, exportFilename, logExport } from "@/lib/customer-data";
import { check } from "@/lib/drafts";
import { verifyLink } from "@/lib/signed-links";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// The owner's customer list as CSV. Two ways in:
//   - GET from the settings page (logged in): /export/customers?r=<restaurant id>
//   - POST from the Download button on /export/download, the page the WhatsApp
//     EXPORT CUSTOMERS link opens (signed token, valid for 1 hour). A button, not a
//     plain link, so WhatsApp's link previews never count as downloads.
// Every download is written to the audit log, once.
export async function GET(req: NextRequest) {
  const rid = req.nextUrl.searchParams.get("r") ?? "";
  // Older WhatsApp links (token in the address) go to the Download page instead.
  if (req.nextUrl.searchParams.get("t")) {
    return Response.redirect(new URL(`/export/download?${req.nextUrl.searchParams}`, req.url), 303);
  }
  const owner = await currentOwner();
  if (!owner) return Response.redirect(new URL(`/login?next=${encodeURIComponent(`/settings?r=${rid}`)}`, req.url), 303);
  if (!owner.restaurantIds.includes(rid)) return new Response("Not found", { status: 404 });
  return download(rid, `from the settings page (${owner.email})`);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const rid = String(form.get("r") ?? "");
  if (!verifyLink("customer-export", rid, String(form.get("t") ?? ""))) {
    return new Response("This download link has expired. Text EXPORT CUSTOMERS on WhatsApp for a new one.", { status: 403 });
  }
  return download(rid, "from the WhatsApp link");
}

async function download(rid: string, via: string) {
  const restaurant = check(await getSupabase().from("restaurants").select("id, slug").eq("id", rid).maybeSingle<Pick<Restaurant, "id" | "slug">>());
  if (!restaurant) return new Response("Not found", { status: 404 });
  const { csv, count } = await exportCustomers(restaurant.id);
  await logExport(restaurant.id, via, count);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(restaurant.slug)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
