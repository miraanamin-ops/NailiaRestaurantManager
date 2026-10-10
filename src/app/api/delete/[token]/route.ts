import type { NextRequest } from "next/server";
import { deleteCustomerData } from "@/lib/customer-data";
import { clientIp, limitKey, MINUTE, overLimit } from "@/lib/rate-limit";
import { getCustomerByUnsubscribeToken } from "@/lib/signups";
import { baseUrlFrom } from "@/lib/supabase";

// "Delete my data" from an email footer: removes the customer's personal details
// (keeping anonymous counts) and logs it in the audit log.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/delete/[token]">) {
  const { token } = await ctx.params;
  if (await overLimit([{ key: limitKey("delete-ip", clientIp(req.headers)), max: 10, windowMs: 10 * MINUTE }])) {
    return new Response("Too many attempts. Please try again in a few minutes.", { status: 429 });
  }
  const customer = await getCustomerByUnsubscribeToken(token);
  if (!customer) return new Response("Not found", { status: 404 });
  await deleteCustomerData(customer, "delete_link");
  return Response.redirect(new URL(`/delete/${token}?done=1`, baseUrlFrom(req.headers)), 303);
}
