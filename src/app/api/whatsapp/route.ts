import { after, type NextRequest } from "next/server";
import twilio from "twilio";
import {
  chat,
  loadRestaurantContext,
  rewriteDraft,
  writeReviewReply,
  type RestaurantContext,
  type StoredMessage,
} from "@/lib/assistant";
import {
  applyEdit,
  approveDraft,
  createDraft,
  getActiveDraft,
  getLearningContext,
  KIND_LABELS,
  saveSkipReason,
  skipDraft,
  startEdit,
  type Draft,
} from "@/lib/drafts";
import { randomDummyReview } from "@/lib/dummy-reviews";
import { getSupabase, type Review } from "@/lib/supabase";
import { BUTTON_IDS, sendText, sendWithApprovalButtons } from "@/lib/whatsapp";

// How many earlier messages Claude sees, so it can follow the conversation.
const HISTORY_LIMIT = 20;

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

type Action = "approve" | "edit" | "skip";

// The public URL Twilio called, used to check the request really came from Twilio.
function publicUrl(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
}

// A tapped button, or a typed 1/2/3 or approve/edit/skip.
function parseAction(buttonPayload: string | undefined, body: string): Action | null {
  if (buttonPayload === BUTTON_IDS.approve) return "approve";
  if (buttonPayload === BUTTON_IDS.edit) return "edit";
  if (buttonPayload === BUTTON_IDS.skip) return "skip";
  const t = body.trim().toLowerCase().replace(/[.!]$/, "");
  if (t === "1" || t === "approve") return "approve";
  if (t === "2" || t === "edit") return "edit";
  if (t === "3" || t === "skip") return "skip";
  return null;
}

function isNewReviewCommand(body: string) {
  return body.trim().toLowerCase().replace(/\s+/g, " ") === "new review";
}

function draftMessage(draft: Draft) {
  const header = `📝 *${KIND_LABELS[draft.kind]}*${draft.audience ? ` for ${draft.audience}` : ""}${draft.version > 1 ? ` (version ${draft.version})` : ""}`;
  return `${header}\n\n${draft.content}`;
}

function stars(n: number) {
  return "⭐".repeat(n);
}

// Twilio calls this every time someone sends a WhatsApp message to the sandbox number.
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!process.env.TWILIO_ACCOUNT_SID || !authToken) {
    console.error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
    return new Response("Server not configured", { status: 500 });
  }

  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) params[key] = String(value);

  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!twilio.validateRequest(authToken, signature, publicUrl(req), params)) {
    console.warn("Rejected request with invalid Twilio signature");
    return new Response("Invalid signature", { status: 403 });
  }

  const owner = params.From; // the person texting, e.g. whatsapp:+447...
  const sandbox = params.To; // the sandbox number
  const body = params.Body ?? "";
  if (!owner || !sandbox) return new Response("Missing From/To", { status: 400 });

  const supabase = getSupabase();
  const ctx = await loadRestaurantContext();

  const { error: inboundError } = await supabase.from("messages").insert({
    restaurant_id: ctx.restaurantId,
    direction: "inbound",
    from_number: owner,
    to_number: sandbox,
    body,
    twilio_sid: params.MessageSid ?? null,
    status: "received",
  });
  if (inboundError) console.error("Failed to log inbound message", inboundError);

  // Reply to Twilio straight away (it gives up after 15 seconds), then do the
  // slow work and send answers as separate WhatsApp messages.
  after(() => handleMessage({ ctx, owner, sandbox, body, buttonPayload: params.ButtonPayload }));

  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}

async function handleMessage(input: {
  ctx: RestaurantContext;
  owner: string;
  sandbox: string;
  body: string;
  buttonPayload: string | undefined;
}) {
  const { ctx, owner, sandbox, body } = input;
  const supabase = getSupabase();

  // Sends a WhatsApp message and records it in the messages table.
  async function send(text: string, withButtons = false) {
    let sid: string | null = null;
    let sentBody = text;
    let error: string | null = null;
    try {
      const sent = withButtons ? await sendWithApprovalButtons(sandbox, owner, text) : await sendText(sandbox, owner, text);
      sid = sent.sid;
      sentBody = sent.body;
    } catch (err) {
      console.error("Failed to send WhatsApp message", err);
      error = `Twilio: ${err instanceof Error ? err.message : String(err)}`;
    }
    const { error: logError } = await supabase.from("messages").insert({
      restaurant_id: ctx.restaurantId,
      direction: "outbound",
      from_number: sandbox,
      to_number: owner,
      body: sentBody,
      twilio_sid: sid,
      status: sid ? "sent" : "failed",
      error,
    });
    if (logError) console.error("Failed to log outbound message", logError);
  }

  try {
    const [active, learning] = await Promise.all([getActiveDraft(ctx.restaurantId), getLearningContext(ctx.restaurantId)]);
    const action = parseAction(input.buttonPayload, body);
    // The draft that Approve / Edit / Skip would apply to, if any.
    const decisionDraft =
      active && (active.waiting_for === "decision" || active.waiting_for === "edit_instructions") ? active : null;

    // Test command: a random new review arrives and gets a drafted reply.
    if (isNewReviewCommand(body)) {
      const pick = randomDummyReview();
      const { data: review, error } = await supabase
        .from("reviews")
        .insert({ restaurant_id: ctx.restaurantId, author_name: pick.author, rating: pick.rating, text: pick.text, replied: false })
        .select("*")
        .single<Review>();
      if (error) throw new Error(error.message);
      const content = await writeReviewReply(ctx, learning, review);
      const draft = await createDraft({
        restaurantId: ctx.restaurantId,
        kind: "review_reply",
        content,
        audience: `Google review by ${review.author_name}`,
        request: "NEW REVIEW test command",
        reviewId: review.id,
      });
      await send(
        `🔔 *New Google review* from ${review.author_name} ${stars(review.rating)}\n_"${review.text}"_\n\n${draftMessage(draft)}`,
        true,
      );
      return;
    }

    // Approve / Edit / Skip on the draft that's waiting.
    if (action && decisionDraft) {
      if (action === "approve") {
        await approveDraft(decisionDraft);
        await send(
          `✅ Approved! Logged as sent (to: ${decisionDraft.audience ?? "customers"})\n_Simulated for now: nothing actually went out._`,
        );
      } else if (action === "edit") {
        await startEdit(decisionDraft);
        await send("✏️ What would you like me to change?");
      } else {
        await skipDraft(decisionDraft);
        await send("👍 Skipped. Quick question so I can learn: why didn't this one work? A few words is fine.");
      }
      return;
    }
    if (input.buttonPayload && action) {
      await send("That draft isn't waiting for an answer any more. Ask me for a new one any time!");
      return;
    }

    // The owner is telling us what to change.
    if (active?.waiting_for === "edit_instructions") {
      const content = await rewriteDraft(ctx, learning, active, body);
      const updated = await applyEdit(active, body, content);
      await send(draftMessage(updated), true);
      return;
    }

    // The owner is telling us why they skipped.
    if (active?.waiting_for === "skip_reason") {
      await saveSkipReason(active, body);
      await send("Thanks, noted. I'll keep that in mind for next time. 🙏");
      return;
    }

    // Anything else: a normal chat, which may produce a new or revised draft.
    const { data: rows, error } = await supabase
      .from("messages")
      .select("direction, body, status")
      // Quoted because numbers look like "whatsapp:+44…" and ":" is special in this filter.
      .or(`from_number.eq."${owner}",to_number.eq."${owner}"`)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT)
      .returns<StoredMessage[]>();
    if (error) throw new Error(error.message);

    const result = await chat(ctx, learning, active, (rows ?? []).reverse());
    if (result.type === "draft") {
      const draft = await createDraft({
        restaurantId: ctx.restaurantId,
        kind: result.kind,
        content: result.content,
        audience: result.audience,
        request: body,
        reviewId: result.reviewId,
        customerId: result.customerId,
      });
      await send(draftMessage(draft), true);
    } else if (result.type === "revise" && active?.waiting_for === "decision") {
      const updated = await applyEdit(active, result.instruction, result.content);
      await send(draftMessage(updated), true);
    } else if (result.type === "text") {
      await send(result.text);
    } else {
      await send("Sorry, I lost track of that draft. Could you ask again?");
    }
  } catch (err) {
    console.error("Failed to handle message", err);
    await send("Sorry, something went wrong on my side. Please try again in a minute. 🙏");
  }
}
