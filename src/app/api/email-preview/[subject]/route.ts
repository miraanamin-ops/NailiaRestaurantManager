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
  return emailPreviewImage(content);
}
