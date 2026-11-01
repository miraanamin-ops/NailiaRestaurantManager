import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { ourWhatsAppNumber } from "@/lib/onboarding/channel";
import type { OwnerMessagePayload } from "@/lib/queue/handlers";
import { kickWorkers } from "@/lib/queue/kick";
import { PRIORITY } from "@/lib/queue/config";
import { concurrencyKeys, keys } from "@/lib/queue/rules";
import { enqueue } from "@/lib/queue/store";
import { getSupabase } from "@/lib/supabase";
import { isPlaceholderNumber } from "@/lib/switches";

// The builder's demo phone (/onboarding/admin/phone): the demo restaurants sit on
// placeholder owner numbers (lib/switches.ts) so the builder's own number can
// belong to a real restaurant. A message typed here goes in exactly as if the
// demo owner had sent it on WhatsApp: logged, then the same queued job as the
// webhook's. Replies are only logged (nothing is sent to a placeholder number,
// lib/whatsapp.ts), and the page shows them.
// Only a demo restaurant on a placeholder number can be used, and only by the
// builder (the page and its action check the login).

export class DemoPhoneError extends Error {}

type DemoRestaurant = { id: string; name: string; slug: string; owner_whatsapp: string | null; is_demo: boolean | null; whatsapp_from: string | null };

export async function demoPhones() {
  const rows =
    check(
      await getSupabase()
        .from("restaurants")
        .select("id, name, slug, owner_whatsapp, is_demo, whatsapp_from")
        .eq("is_demo", true)
        .order("name")
        .returns<DemoRestaurant[]>(),
    ) ?? [];
  return rows.filter((r) => isPlaceholderNumber(r.owner_whatsapp));
}

async function demoRestaurant(restaurantId: string) {
  const r = check(
    await getSupabase()
      .from("restaurants")
      .select("id, name, slug, owner_whatsapp, is_demo, whatsapp_from")
      .eq("id", restaurantId)
      .maybeSingle<DemoRestaurant>(),
  );
  if (!r) throw new DemoPhoneError("That restaurant wasn't found");
  if (r.is_demo !== true || !isPlaceholderNumber(r.owner_whatsapp)) {
    throw new DemoPhoneError(`${r.name} isn't a demo restaurant on a placeholder number, so the demo phone can't act for it`);
  }
  return r;
}

export type PhoneMessage = { id: string; direction: "inbound" | "outbound"; body: string; created_at: string; status: string | null };

export async function demoConversation(restaurantId: string, limit = 40) {
  const r = await demoRestaurant(restaurantId);
  const rows =
    check(
      await getSupabase()
        .from("messages")
        .select("id, direction, body, created_at, status")
        .eq("restaurant_id", r.id)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<PhoneMessage[]>(),
    ) ?? [];
  return { restaurant: r, messages: rows.reverse() };
}

// Sends `body` as the demo restaurant's owner. Returns once it's queued; the
// answer arrives in the conversation a few seconds later.
export async function sendAsDemoOwner(restaurantId: string, body: string, builderEmail: string) {
  const text = body.trim().slice(0, 1600);
  if (!text) throw new DemoPhoneError("Type a message first");
  const r = await demoRestaurant(restaurantId);
  const owner = r.owner_whatsapp!;
  const sandbox = r.whatsapp_from ?? ourWhatsAppNumber();
  const sid = `demo-${randomUUID()}`;
  check(
    await getSupabase().from("messages").insert({
      restaurant_id: r.id,
      direction: "inbound",
      from_number: owner,
      to_number: sandbox,
      body: text,
      twilio_sid: sid,
      status: "received",
    }),
  );
  await logAction({ restaurantId: r.id, actor: "builder", action: "demo_phone", detail: `${builderEmail}: ${text.slice(0, 200)}` }).catch(() => {});
  const payload: OwnerMessagePayload = { kind: "owner", owner, sandbox, body: text, messageSid: sid };
  await enqueue({
    type: "owner_message",
    restaurantId: r.id,
    key: keys.ownerMessage(sid),
    priority: PRIORITY.owner,
    concurrencyKey: concurrencyKeys.whatsapp(r.id),
    payload,
  });
  after(() => kickWorkers(1));
}
