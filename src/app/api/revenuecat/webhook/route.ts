import { NextResponse, type NextRequest } from "next/server";
import { handleStoreEvent, signatureValid } from "@/lib/billing/store-webhook";
import type { StoreEvent } from "@/lib/billing/store-events";

// App Store / Google Play subscription events from RevenueCat (RevenueCat >
// Integrations > Webhooks, with HMAC signing on). Only events signed with
// REVENUECAT_WEBHOOK_SECRET in the last 5 minutes are accepted. A repeat of an event
// already handled gets a 200 and does nothing (lib/billing/store-webhook.ts); a 500
// makes RevenueCat try again later.
export async function POST(req: NextRequest) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const body = await req.text();
  if (!signatureValid(body, req.headers.get("x-revenuecat-webhook-signature"), secret)) {
    console.warn("RevenueCat webhook rejected: bad or missing signature");
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }
  const event = (JSON.parse(body) as { event?: StoreEvent }).event;
  if (!event?.id || !event.type) return NextResponse.json({ error: "no event" }, { status: 400 });
  try {
    return NextResponse.json({ received: true, result: await handleStoreEvent(event) });
  } catch (err) {
    console.error("RevenueCat webhook failed", event.id, event.type, err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
