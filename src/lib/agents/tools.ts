import "server-only";
import { getCampaignForDraft, campaignStats, recipientsFor, SEGMENTS, type Campaign } from "@/lib/campaigns";
import { calendarFor } from "@/lib/local-calendar";
import { check, type Draft } from "@/lib/drafts";
import { emailPreviewImage } from "@/lib/email/preview-image";
import { previewContent } from "@/lib/email/previews";
import { postPreviewPng } from "@/lib/google/post-preview";
import { agentProfile } from "@/lib/profile/versions";
import { getSupabase, type PhotoItem, type Restaurant } from "@/lib/supabase";
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
    } else if (kind === "photo") {
      const r = check(await supabase.from("restaurants").select("photo_library").eq("id", restaurantId).maybeSingle<{ photo_library: PhotoItem[] | null }>());
      const photo = (r?.photo_library ?? []).find((x) => x.id === id);
      out.push(photo ? { ref, found: true, data: photo } : { ref, found: false, reason: "no such photo in the library" });
    } else if (kind === "post") {
      // The same dates get_post_history shows (published, else drafted).
      const posts = (await postHistory(restaurantId, 30)).filter((p) => p.date === id);
      out.push(posts.length ? { ref, found: true, data: posts.map((p) => p.text) } : { ref, found: false, reason: "no Google post on that date" });
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
  const supabase = getSupabase();
  const draft = check(await supabase.from("drafts").select("id, kind, content").eq("restaurant_id", restaurantId).eq("id", draftId).maybeSingle<{ id: string; kind: string; content: string }>());
  // A Google post: a drawing of the post card (name, logo, photo, text).
  if (draft?.kind === "google_post") {
    const [post, r] = await Promise.all([
      supabase.from("google_posts").select("photo_url").eq("restaurant_id", restaurantId).eq("draft_id", draft.id).maybeSingle<{ photo_url: string | null }>(),
      supabase.from("restaurants").select("name, logo_url, brand_color").eq("id", restaurantId).single<{ name: string; logo_url: string | null; brand_color: string }>(),
    ]);
    if (!r.data) return null;
    return postPreviewPng({ name: r.data.name, logoUrl: r.data.logo_url, brandColor: r.data.brand_color, text: draft.content, cta: null, photo: post.data?.photo_url ?? null });
  }
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

// get_post_history: this restaurant's recent Google posts, with the date each went out.
async function postHistory(restaurantId: string, limit = 10) {
  const rows =
    check(
      await getSupabase()
        .from("google_posts")
        .select("text, published_at, created_at")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<{ text: string; published_at: string | null; created_at: string }[]>(),
    ) ?? [];
  return rows.map((r) => ({ date: (r.published_at ?? r.created_at).slice(0, 10), text: r.text }));
}

// get_photo_library: the approved photos (from Google, or sent by the owner or staff).
async function photoLibrary(restaurantId: string) {
  const r = check(await getSupabase().from("restaurants").select("photo_library").eq("id", restaurantId).maybeSingle<{ photo_library: PhotoItem[] | null }>());
  return r?.photo_library ?? [];
}

// get_segments: how many customers each segment can email right now (with consent,
// confirmed, not unsubscribed, and not already sent an offer this week; birthdays excepted).
async function segmentSizes(restaurantId: string, now: Date) {
  const restaurant = check(await getSupabase().from("restaurants").select("*").eq("id", restaurantId).single<Restaurant>());
  const out: Record<string, number> = {};
  for (const s of SEGMENTS) out[s] = (await recipientsFor(restaurant!, s, now, { isBirthday: s === "birthdays_7d" })).eligible.length;
  return out;
}

// get_campaign_history: this restaurant's sent campaigns (newest first) and their results.
async function campaignHistory(restaurantId: string, limit = 10) {
  const campaigns =
    check(
      await getSupabase()
        .from("campaigns")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false })
        .limit(limit)
        .returns<Campaign[]>(),
    ) ?? [];
  return Promise.all(
    campaigns.map(async (c) => {
      const s = await campaignStats(c);
      return {
        id: c.id,
        name: `${c.name} (${c.offer}, sent ${c.sent_at!.slice(0, 10)}, valid ${c.valid_from} to ${c.valid_until}, to ${c.segment})`,
        emailed: s.emailed,
        simulated: s.simulated,
        opened: s.opened,
        clicked: s.clicked,
        redeemed: s.redeemed,
      };
    }),
  );
}

type ToolArgs = {
  get_profile: Record<string, never>;
  get_post_history: Record<string, never>;
  get_photo_library: Record<string, never>;
  get_trends: Record<string, never>;
  get_new_reviews: { reviewId: string };
  get_review_history: Record<string, never>;
  resolve_sources: { refs: string[] };
  get_recent_outputs: { kind: string; excludeDraftId: string | null };
  get_maker_rules: { maker: AgentName };
  get_rendered_preview: { draftId: string };
  get_segments: { now: Date };
  get_campaign_history: Record<string, never>;
  get_local_calendar: { from: string; to: string };
};
export type ToolName = keyof ToolArgs;
type ToolResults = {
  get_profile: Awaited<ReturnType<typeof agentProfile>>;
  get_post_history: Awaited<ReturnType<typeof postHistory>>;
  get_photo_library: PhotoItem[];
  get_trends: string[];
  get_new_reviews: Awaited<ReturnType<typeof reviewById>>;
  get_review_history: Awaited<ReturnType<typeof reviewHistory>>;
  resolve_sources: Resolved[];
  get_recent_outputs: string[];
  get_maker_rules: string;
  get_rendered_preview: Awaited<ReturnType<typeof renderedPreview>>;
  get_segments: Record<string, number>;
  get_campaign_history: Awaited<ReturnType<typeof campaignHistory>>;
  get_local_calendar: Awaited<ReturnType<typeof calendarFor>>;
};

export async function callTool<N extends ToolName>(agent: AgentName, name: N, restaurantId: string, args: ToolArgs[N]): Promise<ToolResults[N]> {
  assertToolAllowed(loadAgent(agent), name);
  return (await runTool(name, agent, restaurantId, args)) as ToolResults[N];
}

async function runTool(name: ToolName, agent: AgentName, restaurantId: string, args: ToolArgs[ToolName]) {
  switch (name) {
    case "get_profile":
      return agentProfile(restaurantId, agent);
    case "get_post_history":
      return postHistory(restaurantId);
    case "get_photo_library":
      return photoLibrary(restaurantId);
    case "get_trends":
      // No trend scan yet: trend ideas wait until there is one.
      return [];
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
    case "get_segments":
      return segmentSizes(restaurantId, (args as ToolArgs["get_segments"]).now);
    case "get_campaign_history":
      return campaignHistory(restaurantId);
    case "get_local_calendar": {
      const a = args as ToolArgs["get_local_calendar"];
      return calendarFor(restaurantId, a.from, a.to);
    }
  }
  throw new Error(`Unknown tool ${name}`);
}
