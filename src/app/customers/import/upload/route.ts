import type { NextRequest } from "next/server";
import { currentOwner } from "@/lib/auth";
import { previewImport } from "@/lib/customer-import";
import { fileKind, MAX_FILE_BYTES, readTable } from "@/lib/sales/pos-file";

// The customer import form (a plain form post): read the file, clean it, and show
// the preview. Logged in, and only for the owner's own restaurant.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const rid = String(form.get("r") ?? "");
  const back = (error: string) => Response.redirect(new URL(`/customers/import?r=${encodeURIComponent(rid)}&error=${encodeURIComponent(error)}`, req.url), 303);
  const owner = await currentOwner();
  if (!owner) return Response.redirect(new URL(`/login?next=${encodeURIComponent(`/customers/import?r=${rid}`)}`, req.url), 303);
  if (!owner.restaurantIds.includes(rid)) return new Response("Not found", { status: 404 });

  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return back("Choose a file first.");
  if (file.size > MAX_FILE_BYTES) return back("That file is too big (over 4 MB). Try splitting it into smaller files.");
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = fileKind(file.type, bytes, file.name);
    if (kind !== "csv" && kind !== "xlsx") return back("Please upload a CSV or Excel (.xlsx) file.");
    const table = await readTable(bytes, kind);
    if (!table) return back("I couldn't read that file. Could you save it as CSV or Excel and try again?");
    const preview = await previewImport({ restaurantId: rid, table, bytes, fileName: file.name, channel: "web", createdBy: owner.email });
    if (!preview.ok) return back(preview.text.replace(/[*_]/g, ""));
    return Response.redirect(new URL(`/customers/import/${preview.imp.id}?r=${encodeURIComponent(rid)}`, req.url), 303);
  } catch (err) {
    console.error("Customer import upload failed", err);
    return back("Something went wrong reading that file. Please try again.");
  }
}
