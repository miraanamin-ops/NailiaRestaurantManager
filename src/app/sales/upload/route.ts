import type { NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { MAX_FILE_BYTES } from "@/lib/sales/pos-file";
import { receivePosFile } from "@/lib/sales/pos-import";

// The sales page's upload form (a plain form post, so files up to 4 MB work).
// Logged in, and only for the owner's own restaurant.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const rid = String(form.get("r") ?? "");
  const back = (params: string) => Response.redirect(new URL(`/sales?r=${encodeURIComponent(rid)}&${params}`, req.url), 303);
  const owner = await currentOwner();
  if (!owner) return Response.redirect(new URL(`/login?next=${encodeURIComponent(`/sales?r=${rid}`)}`, req.url), 303);
  if (!owner.restaurantIds.includes(rid)) return new Response("Not found", { status: 404 });

  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return back(`error=${encodeURIComponent("Choose a file first.")}`);
  if (file.size > MAX_FILE_BYTES) return back(`error=${encodeURIComponent("That file is too big (over 4 MB). Try exporting a shorter period.")}`);

  try {
    const outcome = await receivePosFile({
      restaurantId: rid,
      bytes: Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
      fileName: file.name,
      channel: "web",
      sentBy: owner.email,
      actor: "owner",
    });
    if (outcome.status === "needs_mapping") return Response.redirect(new URL(`/sales/import/${outcome.importId}?r=${encodeURIComponent(rid)}`, req.url), 303);
    const text = outcome.message.replace(/^📊 /, "");
    return back(`${outcome.status === "imported" ? "msg" : "error"}=${encodeURIComponent(text)}`);
  } catch (err) {
    console.error("Sales upload failed", err);
    return back(`error=${encodeURIComponent("Something went wrong reading that file. Please try again.")}`);
  }
}
