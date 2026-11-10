import type { NextRequest } from "next/server";
import { hardBounceFrom, verifyWebhook } from "@/lib/email/webhook";

// Resend's email events (set up in Resend > Webhooks, pointing here, with the
// signing secret in RESEND_WEBHOOK_SECRET). A hard bounce puts the address on the
// suppression list everywhere and counts towards pausing an imported list (over 5%).
// Everything else is acknowledged and ignored.
export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? "";
  const body = await req.text();
  const signed = verifyWebhook(secret, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, body);
  if (!signed) return new Response("Bad signature", { status: 401 });
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Bad body", { status: 400 });
  }
  const bounce = hardBounceFrom(event);
  if (bounce) {
    const { recordHardBounce } = await import("@/lib/customer-import");
    await recordHardBounce(bounce.address, bounce.emailId);
  }
  return new Response("ok");
}
