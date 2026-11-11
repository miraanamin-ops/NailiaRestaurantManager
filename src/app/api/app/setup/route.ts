import type { NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { markUsesApp } from "@/lib/app/app-user";
import { loadChat } from "@/lib/onboarding/dina/chat";
import { overTurnLimit, parseChatBody, runChatAction, type ChatEvent } from "@/lib/onboarding/dina/chat-action";

// Setup with Dina in the app (step 50, phase 4): the website's chat engine
// (lib/onboarding/dina/chat-action.ts), the same conversation and cards.
// GET ?r=: the conversation so far, the chapters and progress (as the web page loads it).
// POST { r, action }: one tap or message; the answer comes back in one go (the events
// the website streams, collected): { messages, progress, skippable, error? }.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    await markUsesApp(id);
    return appJson({ restaurantId: id, ...(await loadChat(id)) });
  });
}

export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const parsed = parseChatBody(await req.json().catch(() => null));
    if (!parsed.success) return appError(400, "bad_action");
    const { r, action } = parsed.data;
    if (!owner.restaurantIds.includes(r)) return appError(403, "not_yours");
    if (await overTurnLimit(r, action)) return appError(429, "slow");
    const events: ChatEvent[] = [];
    await runChatAction(r, action, (e) => events.push(e), { gapMs: 0 });
    const state = events.findLast((e) => e.type === "state") as { progress?: unknown; skippable?: boolean } | undefined;
    const error = events.find((e) => e.type === "error") as { text?: string } | undefined;
    return appJson({
      messages: events.filter((e) => e.type === "message").map((e) => e.message),
      progress: state?.progress ?? null,
      skippable: state?.skippable ?? false,
      error: error?.text ?? null,
    });
  });
}
