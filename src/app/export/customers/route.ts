import type { NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { exportCustomers, exportFilename, logExport } from "@/lib/customer-data";
import { check } from "@/lib/drafts";
import { verifyLink } from "@/lib/signed-links";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// The owner's customer list as CSV. Two ways in:
//   - the settings page (logged in): /export/customers?r=<restaurant id>
//   - the link sent on WhatsApp after "EXPORT CUSTOMERS": also ?t=<signed token>, valid for 1 hour
// Every download is written to the audit log.
export async function GET(req: NextRequest) {
  const rid = req.nextUrl.searchParams.get("r") ?? "";
  const token = req.nextUrl.searchParams.get("t");
  let via: string;
  if (token) {
    if (!verifyLink("customer-export", rid, token)) {
      return new Response("This download link has expired. Text EXPORT CUSTOMERS on WhatsApp for a new one.", { status: 403 });
    }
    via = "from the WhatsApp link";
  } else {
    const owner = await currentOwner();
    if (!owner) return Response.redirect(new URL(`/login?next=${encodeURIComponent(`/settings?r=${rid}`)}`, req.url), 303);
    if (!owner.restaurantIds.includes(rid)) return new Response("Not found", { status: 404 });
    via = `from the settings page (${owner.email})`;
  }
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
