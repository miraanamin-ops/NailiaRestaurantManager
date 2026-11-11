import { currentOwner } from "@/lib/auth";
import { overTurnLimit, parseChatBody, runChatAction } from "@/lib/onboarding/dina/chat-action";

// The web chat with Dina: one owner action in, Dina's answer streamed back as lines
// of JSON, one event per line (lib/onboarding/dina/chat-action.ts, shared with the
// app's setup screen). Only the restaurant's own owner (or the builder) can use it.

export const maxDuration = 120;

export async function POST(req: Request) {
  const owner = await currentOwner();
  if (!owner) return Response.json({ error: "Please log in again." }, { status: 401 });
  const parsed = parseChatBody(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That didn't look right." }, { status: 400 });
  const { r, action } = parsed.data;
  if (!owner.restaurantIds.includes(r)) return Response.json({ error: "Not your restaurant." }, { status: 403 });
  if (await overTurnLimit(r, action)) {
    return Response.json({ error: "That's a lot of messages in a short time. Give it a few minutes." }, { status: 429 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await runChatAction(r, action, (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
