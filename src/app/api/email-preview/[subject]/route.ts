import type { NextRequest } from "next/server";
import { emailPreviewImage } from "@/lib/email/preview-image";
import { previewContent, verifyPreview } from "@/lib/email/previews";

// The picture of an email that the owner sees on WhatsApp before approving it.
// Public (Twilio fetches it) but only with a valid signature from lib/email/previews.ts.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/email-preview/[subject]">) {
  const { subject } = await ctx.params;
  if (!verifyPreview(subject, req.nextUrl.searchParams.get("s"))) return new Response("Not found", { status: 404 });
  const content = await previewContent(subject);
  if (!content) return new Response("Not found", { status: 404 });
  // ?format=html: the real email (the app shows it full screen), not the WhatsApp picture.
  if (req.nextUrl.searchParams.get("format") === "html") {
    const { renderEmail } = await import("@/lib/email/templates");
    return new Response((await renderEmail(content)).html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
  }
  return emailPreviewImage(content);
}
