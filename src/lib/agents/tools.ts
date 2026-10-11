import "server-only";
import { getCampaignForDraft, campaignStats, recipientsFor, type Campaign } from "@/lib/campaigns";
import { check, type Draft } from "@/lib/drafts";
import { emailPreviewImage } from "@/lib/email/preview-image";
import { previewContent } from "@/lib/email/previews";
import { agentProfile } from "@/lib/profile/versions";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { assertToolAllowed, type AgentName } from "./definition";
import { loadAgent } from "./loader";
import { parseSourceRef } from "./sources";

// The agents' tools. Each one only reads this restaurant's data. Every use goes
// through callTool, which refuses any tool not in the agent's front matter
// (the allow-list). No tool sends, publishes or spends: only the gate does that.

export type Resolved = { ref: string; found: true; data: unknown } | { ref: string; found: false; reason: string };

// resolve_sources: the real data behind each entry in a draft's sources_used.
async function resolveSources(restaurantId: string, refs: string[]): Promise<Resolved[]> {
  const supabase = getSupabase();
  const profile = (await agentProfile(restaurantId, "checker")).fields;
  const out: Resolved[] = [];
  for (const ref of refs) {
    const parsed = parseSourceRef(ref);
    if (!parsed) {
      out.push({ ref, found: false, reason: "not a source reference" });
      continue;
    }
    const { kind, id } = parsed;
    if (kind === "profile") {
      out.push(id in profile ? { ref, found: true, data: profile[id] ?? null } : { ref, found: false, reason: "no such profile field" });
    } else if (kind === "review") {
      const review = check(
        await supabase
          .from("reviews")
          .select("id, author_name, rating, text, review_date")
          .eq("restaurant_id", restaurantId)
          .eq("id", id)
          .maybeSingle(),
      );
      out.push(review ? { ref, found: true, data: review } : { ref, found: false, reason: "no such review for this restaurant" });
    } else if (kind === "request") {
      const draft = check(await supabase.from("drafts").select("request").eq("restaurant_id", restaurantId).eq("id", id).maybeSingle<{ request: string | null }>());
      out.push(draft?.request ? { ref, found: true, data: { owner_asked: draft.request } } : { ref, found: false, reason: "no owner request recorded" });
    } else if (kind === "segment") {
      const restaurant = check(await supabase.from("restaurants").select("*").eq("id", restaurantId).single<Restaurant>());
      const { eligible, excluded } = await recipientsFor(restaurant!, id as Parameters<typeof recipientsFor>[1], new Date());
      out.push({ ref, found: true, data: { segment: id, can_be_emailed: eligible.length, left_out_no_consent: excluded } });
    } else if (kind === "history") {
      const campaign = check(await supabase.from("campaigns").select("*").eq("restaurant_id", restaurantId).eq("id", id).maybeSingle<Campaign>());
      out.push(campaign ? { ref, found: true, data: { campaign: { name: campaign.name, offer: campaign.offer, sent_at: campaign.sent_at }, results: await campaignStats(campaign) } } : { ref, found: false, reason: "no such campaign" });
    } else {
      out.push({ ref, found: false, reason: `${kind} sources aren't available yet` });
    }
  }
  return out;
}

// get_recent_outputs: the last 10 drafts of the same kind, to catch repetition.
async function recentOutputs(restaurantId: string, kind: string, excludeId: string | null, limit = 10) {
  let query = getSupabase()
    .from("drafts")
    .select("id, content, created_at")
    .eq("restaurant_id", restaurantId)
    .eq("kind", kind)
    .in("status", ["sent", "approved", "queued", "pending"])
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (excludeId) query = query.neq("id", excludeId);
  const rows = check(await query.returns<Pick<Draft, "id" | "content" | "created_at">[]>()) ?? [];
  return rows.slice(0, limit).map((r) => r.content);
}

// get_rendered_preview: a picture of the email as a customer sees it (emails only for now).
async function renderedPreview(restaurantId: string, draftId: string): Promise<{ media_type: "image/png"; data: string } | null> {
  const draft = check(await getSupabase().from("drafts").select("id, kind").eq("restaurant_id", restaurantId).eq("id", draftId).maybeSingle<{ id: string; kind: string }>());
  if (draft?.kind !== "email_campaign" || !(await getCampaignForDraft(draft.id))) return null;
  const content = await previewContent(`draft-${draft.id}`);
  if (!content) return null;
  const png = await emailPreviewImage(content).arrayBuffer();
  return { media_type: "image/png", data: Buffer.from(png).toString("base64") };
}

// get_new_reviews: one review of this restaurant (the one being replied to).
async function reviewById(restaurantId: string, reviewId: string) {
  return check(
    await getSupabase()
      .from("reviews")
      .select("id, author_name, rating, text, review_date")
      .eq("restaurant_id", restaurantId)
      .eq("id", reviewId)
      .maybeSingle<{ id: string; author_name: string; rating: number | null; text: string | null; review_date: string }>(),
  );
}

// get_review_history: recent replies (to avoid repeating openings and closings),
// and the owner's edits to past replies (the tone they prefer).
async function reviewHistory(restaurantId: string) {
  const supabase = getSupabase();
  const [replies, edits] = await Promise.all([
    recentOutputs(restaurantId, "review_reply", null),
    supabase
      .from("draft_feedback")
      .select("note, before_content, after_content")
      .eq("restaurant_id", restaurantId)
      .eq("draft_kind", "review_reply")
      .eq("kind", "edit")
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<{ note: string; before_content: string | null; after_content: string | null }[]>(),
  ]);
  return {
    recent_replies: replies,
    owner_edits: (check(edits) ?? []).map((e) => ({ note: e.note, before: e.before_content ?? "", after: e.after_content ?? "" })),
  };
}

type ToolArgs = {
  get_profile: Record<string, never>;
  get_new_reviews: { reviewId: string };
  get_review_history: Record<string, never>;
  resolve_sources: { refs: string[] };
  get_recent_outputs: { kind: string; excludeDraftId: string | null };
  get_maker_rules: { maker: AgentName };
  get_rendered_preview: { draftId: string };
};
export type ToolName = keyof ToolArgs;
type ToolResults = {
  get_profile: Awaited<ReturnType<typeof agentProfile>>;
  get_new_reviews: Awaited<ReturnType<typeof reviewById>>;
  get_review_history: Awaited<ReturnType<typeof reviewHistory>>;
  resolve_sources: Resolved[];
  get_recent_outputs: string[];
  get_maker_rules: string;
  get_rendered_preview: Awaited<ReturnType<typeof renderedPreview>>;
};

export async function callTool<N extends ToolName>(agent: AgentName, name: N, restaurantId: string, args: ToolArgs[N]): Promise<ToolResults[N]> {
  assertToolAllowed(loadAgent(agent), name);
  return (await runTool(name, agent, restaurantId, args)) as ToolResults[N];
}

async function runTool(name: ToolName, agent: AgentName, restaurantId: string, args: ToolArgs[ToolName]) {
  switch (name) {
    case "get_profile":
      return agentProfile(restaurantId, agent);
    case "get_new_reviews":
      return reviewById(restaurantId, (args as ToolArgs["get_new_reviews"]).reviewId);
    case "get_review_history":
      return reviewHistory(restaurantId);
    case "resolve_sources":
      return resolveSources(restaurantId, (args as ToolArgs["resolve_sources"]).refs);
    case "get_recent_outputs": {
      const a = args as ToolArgs["get_recent_outputs"];
      return recentOutputs(restaurantId, a.kind, a.excludeDraftId);
    }
    case "get_maker_rules":
      return loadAgent((args as ToolArgs["get_maker_rules"]).maker).rules;
    case "get_rendered_preview":
      return renderedPreview(restaurantId, (args as ToolArgs["get_rendered_preview"]).draftId);
  }
  throw new Error(`Unknown tool ${name}`);
}
