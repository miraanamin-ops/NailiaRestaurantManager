import type { NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { cancelPreview, confirmImport } from "@/lib/customer-import";
import { BASES, type Basis, UNKNOWN_BASIS_REPLY, webDeclarationText } from "@/lib/customer-import/rules";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// The import preview's form: Cancel, or confirm with the basis, the declaration and
// double opt-in. The contacts are added; the welcome email waits on Approvals.
export async function POST(req: NextRequest, ctx: RouteContext<"/customers/import/[id]/confirm">) {
  const { id } = await ctx.params;
  const form = await req.formData();
  const rid = String(form.get("r") ?? "");
  const go = (path: string) => Response.redirect(new URL(path, req.url), 303);
  const owner = await currentOwner();
  if (!owner) return go(`/login?next=${encodeURIComponent(`/customers/import/${id}?r=${rid}`)}`);
  if (!owner.restaurantIds.includes(rid)) return new Response("Not found", { status: 404 });
  const plain = (s: string) => encodeURIComponent(s.replace(/[*_]/g, ""));

  if (form.get("do") === "cancel") {
    await cancelPreview(rid, id);
    return go(`/customers?r=${rid}&done=${plain("Cancelled: nothing was imported.")}`);
  }
  const basis = String(form.get("basis") ?? "") as Basis;
  if (!(BASES as readonly string[]).includes(basis)) return go(`/customers/import/${id}?r=${rid}&error=${plain("Choose how these people agreed to hear from you.")}`);
  if (basis === "unknown") {
    await cancelPreview(rid, id);
    return go(`/customers/import?r=${rid}&error=${plain(UNKNOWN_BASIS_REPLY)}`);
  }
  if (form.get("declaration") !== "yes") return go(`/customers/import/${id}?r=${rid}&error=${plain("Please tick to confirm the declaration.")}`);

  const { data: restaurant } = await getSupabase().from("restaurants").select("*").eq("id", rid).maybeSingle<Restaurant>();
  if (!restaurant) return new Response("Not found", { status: 404 });
  const { getImport } = await import("@/lib/customer-import");
  const imp = await getImport(rid, id);
  const result = await confirmImport({ restaurant, importId: id, basis, declaredBy: owner.email, doubleOptIn: form.get("double_opt_in") === "yes", declaration: webDeclarationText(restaurant.name, imp?.rows_to_add ?? 0) });
  if (!result.ok) return go(`/customers?r=${rid}&oops=${plain(result.text)}`);
  return go(`/approvals?r=${rid}&done=${plain(`Added ${result.added} customers. Nobody has been emailed yet: approve their welcome email below.`)}`);
}
