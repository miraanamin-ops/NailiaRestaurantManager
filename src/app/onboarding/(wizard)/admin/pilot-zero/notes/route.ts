import { currentOwner } from "@/lib/auth";
import { notesCsv } from "@/lib/pilot-notes";

// The Pilot Zero log (#note) as CSV (lib/pilot-notes.ts). Builder only.
export async function GET(req: Request) {
  const owner = await currentOwner();
  if (!owner) return Response.redirect(new URL("/login?next=/onboarding/admin/pilot-zero", req.url), 303);
  if (!owner.isBuilder) return new Response("Not found", { status: 404 });
  const { csv } = await notesCsv();
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pilot-zero-notes-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
