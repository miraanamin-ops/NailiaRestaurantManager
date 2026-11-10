import type { NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { removeImport } from "@/lib/customer-import";

// "Remove this import" on the customers page: the whole batch off the list in one go.
export async function POST(req: NextRequest, ctx: RouteContext<"/customers/import/[id]/remove">) {
  const { id } = await ctx.params;
  const form = await req.formData();
  const rid = String(form.get("r") ?? "");
  const owner = await currentOwner();
  if (!owner) return Response.redirect(new URL(`/login?next=${encodeURIComponent(`/customers?r=${rid}`)}`, req.url), 303);
  if (!owner.restaurantIds.includes(rid)) return new Response("Not found", { status: 404 });
  const result = await removeImport(rid, id, owner.isBuilder && !owner.restaurantIds.length ? "builder" : "owner");
  const text = encodeURIComponent(result.text.replace(/^🗑️ /, ""));
  return Response.redirect(new URL(`/customers?r=${rid}&${result.ok ? "done" : "oops"}=${text}`, req.url), 303);
}
