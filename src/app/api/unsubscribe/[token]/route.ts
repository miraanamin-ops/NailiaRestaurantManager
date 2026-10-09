import type { NextRequest } from "next/server";
import { unsubscribe } from "@/lib/signups";
import { baseUrlFrom } from "@/lib/supabase";

// Two ways in, both remove consent immediately:
// - the "Unsubscribe" button on /unsubscribe/[token] (a normal form post)
// - one-click unsubscribe from Gmail / Outlook / Apple Mail (RFC 8058),
//   which posts "List-Unsubscribe=One-Click" to the link in the email headers.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  const body = await req.text();
  const oneClick = body.includes("List-Unsubscribe=One-Click");

  const customer = await unsubscribe(token, oneClick ? "one_click_header" : "unsubscribe_link", req.headers.get("user-agent"));
  if (!customer) return new Response("Not found", { status: 404 });

  if (oneClick) return new Response("Unsubscribed", { status: 200 });
  return Response.redirect(new URL(`/unsubscribe/${token}?done=1`, baseUrlFrom(req.headers)), 303);
}
