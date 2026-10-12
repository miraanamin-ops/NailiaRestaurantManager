import "server-only";
import { randomUUID } from "node:crypto";
import { logAction } from "@/lib/audit";
import { createDraft, type AgentCheck, type Draft, type DraftKind } from "@/lib/drafts";
import { ownerChannel } from "@/lib/followups";
import { draftMessage } from "@/lib/format";
import { postPreviewPng } from "@/lib/google/post-preview";
import { messageOwner } from "@/lib/notify";
import { getSupabase, type PhotoItem, type Restaurant } from "@/lib/supabase";
import { isTestMode } from "@/lib/test-mode";
import { londonToday } from "./checker-core";
import { confirmedFields, goLiveChecklist } from "./go-live";
import { enqueueAgentJob, recordAgentRun, type AgentJob, type JobOutcome } from "./jobs";
import { agentMode } from "./modes";
import { liveChecks } from "./reputation";
import { callTool } from "./tools";
import { visibilityLoop, type PhotoInput, type VisibilityDeps, type VisibilityInput, type VisibilityOutcome } from "./visibility-core";
import { describeProfileChange, PHOTO_TIPS, type ProfileChangedEvent, type VisibilityOutput, type VisibilityTask } from "./visibility-rules";

// The Visibility agent with the database: its input (profile, post history,
// photos), the checker's data, and shadow mode. In shadow mode it runs next to
// today's code (the Monday/Thursday post, captions for owner photos) and on new
// work (staff photos, profile changes, the weekly content brief); its drafts and
// the checker's verdicts are saved in shadow_drafts for the /log comparison, and
// nobody sees anything new.

function ok<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// Live only once the go-live checklist passes (logo, colours, hours, emoji setting,
// 5+ photos), and for now only with TEST_MODE on: Visibility's new messages (staff
// tips, questions, hours updates) mustn't reach real people or Google before then.
export async function visibilityMode(restaurant: Restaurant) {
  const mode = agentMode(restaurant, "visibility");
  if (mode === "live" && (!isTestMode() || !goLiveChecklist(restaurant, "visibility", await confirmedFields(restaurant.id)).ready)) return "shadow";
  return mode;
}

// ---------- Inputs ----------

export type VisibilityJob = {
  task: VisibilityTask;
  slot?: "Monday" | "Thursday" | "owner_request" | null;
  request?: string | null;
  photo?: { url: string; content_type: string; note: string; sender: "owner" | "staff"; staff_number?: string | null } | null;
  event?: ProfileChangedEvent | null;
  legacy_draft_id?: string | null;
  legacy_text?: string | null;
};

async function photoFrom(p: NonNullable<VisibilityJob["photo"]>): Promise<PhotoInput> {
  const res = await fetch(p.url);
  if (!res.ok) throw new Error(`Couldn't load the photo (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  const media_type = (["image/png", "image/webp", "image/gif"].includes(p.content_type) ? p.content_type : "image/jpeg") as NonNullable<PhotoInput["image"]>["media_type"];
  return { image: { media_type, data }, note: p.note, sender: p.sender };
}

export async function visibilityInput(restaurantId: string, job: VisibilityJob): Promise<VisibilityInput> {
  const [profile, posts, trends, photo] = await Promise.all([
    callTool("visibility", "get_profile", restaurantId, {}),
    callTool("visibility", "get_post_history", restaurantId, {}),
    callTool("visibility", "get_trends", restaurantId, {}),
    job.photo ? photoFrom(job.photo) : Promise.resolve(null),
  ]);
  return {
    task: job.task,
    profile,
    history: { recent_posts: posts },
    slot: job.slot ?? null,
    request: job.request ?? null,
    photo,
    event: job.event ?? null,
    trends,
    today: londonToday(),
  };
}

export async function visibilityDeps(restaurant: Restaurant, input: VisibilityInput): Promise<VisibilityDeps> {
  const [checkerProfile, recent] = await Promise.all([
    callTool("checker", "get_profile", restaurant.id, {}),
    callTool("checker", "get_recent_outputs", restaurant.id, { kind: "google_post", excludeDraftId: null }),
  ]);
  const library = restaurant.photo_library ?? [];
  return {
    resolve: (refs) => callTool("checker", "resolve_sources", restaurant.id, { refs }),
    checkerProfile,
    recent,
    // A drawing of the Google post (with the photo it goes with) for the brand checks.
    preview: async (out: VisibilityOutput) => {
      if (out.type !== "google_post" && out.type !== "google_photo") return null;
      const photo = input.photo?.image ? `data:${input.photo.image.media_type};base64,${input.photo.image.data}` : (library.find((p) => p.id === out.photo_id)?.url ?? null);
      return postPreviewPng({ name: restaurant.name, logoUrl: restaurant.logo_url, brandColor: restaurant.brand_color, text: out.content.text, cta: out.content.cta, photo }).catch(() => null);
    },
  };
}

export async function runVisibilityFor(restaurant: Restaurant, job: VisibilityJob, label: string) {
  const input = await visibilityInput(restaurant.id, job);
  const outcome = await visibilityLoop(input, await visibilityDeps(restaurant, input), label);
  return { outcome, profileVersion: input.profile.version };
}

// ---------- The photo library ----------

// Adds a photo the owner (or, once Visibility passed it, a staff member) sent.
// Logged as the system, so the owner's UNDO isn't spent on it; it's still a profile version.
export async function addToPhotoLibrary(restaurant: Pick<Restaurant, "id" | "photo_library">, url: string, source: PhotoItem["source"], caption: string | null) {
  const before = restaurant.photo_library ?? [];
  if (before.some((p) => p.url === url)) return before;
  const after = [...before, { id: `ph_${randomUUID().slice(0, 8)}`, url, source, caption, added_at: new Date().toISOString() }];
  const { error } = await getSupabase().from("restaurants").update({ photo_library: after }).eq("id", restaurant.id);
  if (error) {
    // Before supabase/021_visibility.sql has been run there's no library yet.
    console.error("Couldn't add the photo to the library", error);
    return before;
  }
  await logAction({ restaurantId: restaurant.id, actor: "system", action: "setting", detail: `Added a photo to the library (sent by the ${source})`, data: { field: "photo_library", before, after } });
  return after;
}

// ---------- Shadow mode ----------

function jobKey(job: VisibilityJob) {
  if (job.task === "google_post" && job.legacy_draft_id) return `visibility:post:${job.legacy_draft_id}`;
  if (job.task === "photo" && job.photo) return `visibility:photo:${job.photo.url}`;
  if (job.task === "profile_changed" && job.event) return `visibility:change:${job.event.field}:${job.event.to}`.slice(0, 200);
  return `visibility:${job.task}:${randomUUID()}`;
}

const TRIGGERS: Record<VisibilityTask, string> = {
  google_post: "weekly_plan_monday",
  photo: "staff_photo_received",
  profile_changed: "profile_changed",
  content_brief: "weekly_plan_monday",
};

// Queued next to today's work (or for new work). Never throws.
export async function queueVisibilityShadow(restaurant: Restaurant, job: VisibilityJob, key?: string) {
  try {
    if ((await visibilityMode(restaurant)) !== "shadow") return null;
    return await enqueueAgentJob({ restaurantId: restaurant.id, key: key ?? jobKey(job), agent: "visibility", kind: "visibility_shadow", trigger: TRIGGERS[job.task], input: job as Record<string, unknown> });
  } catch (err) {
    console.error("Couldn't queue Visibility in shadow mode", err);
    return null;
  }
}

export function visibilityOutcomeLine(outcome: VisibilityOutcome) {
  if (outcome.kind === "unusable") return `would say the photo can't be used (${outcome.output.photo_check?.reason_code}: ${outcome.output.photo_check?.reason})`;
  const rev = outcome.revisions ? ` after ${outcome.revisions} revision${outcome.revisions === 1 ? "" : "s"}` : "";
  if (outcome.kind === "reply") return `would draft a ${outcome.output.type.replace("_", " ")} (checker ${outcome.checker.verdict}${rev})`;
  return `would ask the owner${outcome.by === "checker" ? ` (the checker escalated${rev})` : ""}: ${outcome.question}`;
}

const TASK_WORDS: Record<VisibilityTask, string> = { google_post: "the Google post", photo: "a photo", profile_changed: "a profile change", content_brief: "the weekly content brief" };

export async function runVisibilityShadow(job: AgentJob): Promise<JobOutcome> {
  const input = job.input as unknown as VisibilityJob;
  const restaurant = ok(await getSupabase().from("restaurants").select("*").eq("id", job.restaurant_id).single<Restaurant>());
  if (!restaurant) throw new Error("Restaurant not found");
  const { outcome, profileVersion } = await runVisibilityFor(restaurant, input, `${TASK_WORDS[input.task]} (shadow)`);
  ok(
    await getSupabase()
      .from("shadow_drafts")
      .insert({
        restaurant_id: job.restaurant_id,
        agent: "visibility",
        agent_version: outcome.agentVersion,
        checker_version: outcome.checkerVersion,
        job_id: job.id,
        source: input.photo?.sender === "staff" ? "staff_photo" : input.task === "photo" ? "owner_photo" : input.task,
        task: input.task,
        subject: { slot: input.slot ?? null, request: input.request ?? null, photo_url: input.photo?.url ?? null, sender: input.photo?.sender ?? null, event: input.event ?? null },
        legacy_draft_id: input.legacy_draft_id ?? null,
        legacy_text: input.legacy_text ?? null,
        outcome: outcome.kind === "unusable" ? "unusable" : outcome.kind,
        output: outcome.output,
        question: outcome.kind === "question" ? outcome.question : null,
        checker: outcome.checker,
        revisions: outcome.revisions,
        steps: outcome.steps,
        profile_version: profileVersion,
      }),
  );
  return {
    output: { outcome: outcome.kind, revisions: outcome.revisions, checker_version: outcome.checkerVersion, steps: outcome.steps },
    agentVersion: outcome.agentVersion,
    verdict: outcome.kind === "reply" ? outcome.checker.verdict : outcome.kind,
    usage: outcome.usage,
    actor: "visibility",
    action: "agent_drafted",
    detail: `Visibility (shadow, v${outcome.agentVersion}) on ${TASK_WORDS[input.task]}: ${visibilityOutcomeLine(outcome)}`,
  };
}

// A staff member sent a photo that isn't a till report. Shadow mode: it's saved and
// Visibility checks it in the background (the staff member gets today's reply).
export async function staffPhotoReceived(restaurant: Restaurant, media: { url: string; contentType: string }, note: string, staffNumber: string) {
  const mode = await visibilityMode(restaurant);
  if (mode === "off") return null;
  const { downloadTwilioMedia, isSupportedImage, savePostPhoto } = await import("@/lib/photos");
  if (!isSupportedImage(media.contentType)) return null;
  const bytes = await downloadTwilioMedia(media.url);
  const url = await savePostPhoto(restaurant.id, bytes, media.contentType);
  const job: VisibilityJob = { task: "photo", photo: { url, content_type: media.contentType, note: note.trim(), sender: "staff", staff_number: staffNumber } };
  if (mode === "live") await queueVisibilityLive(restaurant, job);
  else await queueVisibilityShadow(restaurant, job);
  return mode;
}

// ---------- Profile changes (hours, special hours, the menu) ----------

const CHANGE_FIELDS: Record<string, ProfileChangedEvent["field"]> = { hours: "hours", special_hours: "special_hours", menu: "menu" };

// A profile field Google shows changed (recorded as a profile version): Visibility
// drafts the matching Google update. Only for active restaurants (not during
// onboarding). Never throws: the change itself is already saved.
export async function profileChanged(restaurantId: string, field: string, before: unknown, after: unknown) {
  try {
    const name = CHANGE_FIELDS[field];
    if (!name) return null;
    const event = describeProfileChange(name, before, after);
    if (!event) return null;
    const restaurant = ok(await getSupabase().from("restaurants").select("*").eq("id", restaurantId).maybeSingle<Restaurant>());
    if (!restaurant?.active) return null;
    const mode = await visibilityMode(restaurant);
    if (mode === "shadow") return await queueVisibilityShadow(restaurant, { task: "profile_changed", event });
    if (mode === "live") return await queueVisibilityLive(restaurant, { task: "profile_changed", event });
    return null;
  } catch (err) {
    console.error("Couldn't pass the profile change to Visibility", err);
    return null;
  }
}

// ---------- Live mode ----------

export async function queueVisibilityLive(restaurant: Restaurant, job: VisibilityJob, key?: string) {
  return enqueueAgentJob({ restaurantId: restaurant.id, key: key ?? `${jobKey(job)}:live`, agent: "visibility", kind: "visibility_live", trigger: TRIGGERS[job.task], input: job as Record<string, unknown> });
}

const UPDATE_KIND: Partial<Record<VisibilityOutput["type"], DraftKind>> = { hours_update: "hours_update", menu_update: "menu_update" };

// What the owner approves for an hours or menu change: Visibility's note, then exactly what changes.
export function updateText(out: VisibilityOutput) {
  return `${out.content.text.trim()}\n\nOn Google now: ${out.change?.from ?? ""}\nAfter you approve: ${out.change?.to ?? ""}`;
}

// The weekly content brief as one WhatsApp message the owner can forward to the team.
export function contentBriefText(out: VisibilityOutput) {
  const shoots = out.shoots.map(
    (s, i) =>
      `*${i + 1}. ${s.what}* (${s.day}, ${s.platform})\nWhere: ${s.where}\nHow: ${s.how}\nWho: ${s.who}\nCaption: ${s.caption}${s.hashtags.length ? `\n${s.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}` : ""}`,
  );
  return `📸 *This week's content brief* (forward this to the team)\n\n${out.content.text.trim()}\n\n${shoots.join("\n\n")}`;
}

// Runs Visibility for real (TEST_MODE only, see visibilityMode): Google posts and
// photo captions become drafts for the owner; hours and menu updates are drafts that
// always need Approve; an unusable staff photo gets a fixed tip; questions go to the owner.
export async function runVisibilityLive(job: AgentJob): Promise<JobOutcome> {
  const input = job.input as unknown as VisibilityJob;
  const restaurant = ok(await getSupabase().from("restaurants").select("*").eq("id", job.restaurant_id).single<Restaurant>());
  if (!restaurant) throw new Error("Restaurant not found");
  const { outcome } = await runVisibilityFor(restaurant, input, `${TASK_WORDS[input.task]} (live)`);
  const channel = ownerChannel(restaurant);
  const base = {
    output: { outcome: outcome.kind, revisions: outcome.revisions, steps: outcome.steps },
    agentVersion: outcome.agentVersion,
    usage: outcome.usage,
    actor: "visibility" as const,
    action: "agent_drafted" as const,
    detail: `Visibility (live, v${outcome.agentVersion}) on ${TASK_WORDS[input.task]}: ${visibilityOutcomeLine(outcome)}`,
  };

  if (outcome.kind === "unusable") {
    const reason = outcome.output.photo_check?.reason_code ?? "other";
    const tip = PHOTO_TIPS[reason === "ok" ? "other" : reason];
    if (input.photo?.sender === "staff" && input.photo.staff_number && restaurant.whatsapp_from) {
      // Fixed wording (never the AI's), to the staff number that sent the photo.
      await messageOwner({ restaurantId: restaurant.id, from: restaurant.whatsapp_from, to: input.photo.staff_number }, tip);
    } else if (channel) {
      await messageOwner(channel, `📷 I can't use that photo for Google: ${outcome.output.photo_check?.reason ?? "it won't work"}\n\n${tip.replace(/^📸 Thanks! /, "")}`);
    }
    return { ...base, verdict: "unusable" };
  }

  if (outcome.kind === "question") {
    if (channel) await messageOwner(channel, `❓ ${outcome.question}`);
    return { ...base, verdict: "question" };
  }

  const out = outcome.output;
  if (out.type === "content_brief") {
    if (channel) await messageOwner(channel, contentBriefText(out));
    return { ...base, verdict: outcome.checker.verdict };
  }

  const agentCheck: AgentCheck = {
    mode: "live",
    job_id: job.id,
    agent_version: outcome.checkerVersion,
    draft_version: 1,
    verdict: "pass",
    checks: outcome.checker.checks,
    minor_fixes: outcome.checker.minor_fixes,
    owner_question: null,
    notes: outcome.checker.notes,
    at: new Date().toISOString(),
  };
  const update = UPDATE_KIND[out.type];
  const text = update ? updateText(out) : out.content.text;
  const checks = liveChecks(text, outcome.checker, restaurant.discount_cap_percent);
  // Hours and menu updates and the owner's own photos come straight to them; weekly posts and staff photos wait for the brief.
  const present = Boolean(update) || input.photo?.sender === "owner" || input.slot === "owner_request";
  let draft: Draft;
  if (update) {
    draft = await createDraft({
      restaurantId: restaurant.id,
      kind: update,
      content: text,
      audience: "your Google listing",
      request: `Your ${input.event?.field === "menu" ? "menu" : "hours"} changed: the matching Google update`,
      checks,
      mode: "present",
      actor: "visibility",
      agentCheck,
      agentInput: { event: input.event ?? null, change: out.change },
    });
  } else {
    if (input.photo?.sender === "staff") await addToPhotoLibrary(restaurant, input.photo.url, "staff", out.content.text);
    const { createAgentPostDraft } = await import("@/lib/google-jobs");
    draft = await createAgentPostDraft(restaurant, {
      text,
      photoUrl: input.photo?.url ?? restaurant.photo_library?.find((p) => p.id === out.photo_id)?.url ?? null,
      request: input.photo ? `Photo from ${input.photo.sender === "staff" ? "the team" : "you"}` : input.slot === "owner_request" ? (input.request ?? "Google post") : "Twice-weekly Google post",
      checks,
      agentCheck,
      mode: present ? "present" : "hold",
    });
  }
  if (present && channel) await messageOwner(channel, draftMessage(draft, restaurant), true);
  return { ...base, verdict: outcome.checker.verdict };
}

// ---------- Mondays: bank holidays ahead, and the weekly content brief ----------

// Each Monday (morning job): any UK bank holiday in the next 4 weeks with no
// special hours set becomes a question for the owner (live: held for the brief,
// with Same hours / Closed / Different hours; shadow: recorded as what would be
// asked). Plain code, no AI. Each holiday is asked about once. Then the weekly
// content brief is queued. Never throws: the morning job carries on.
export async function mondayVisibility(restaurant: Restaurant, today: string) {
  try {
    const mode = await visibilityMode(restaurant);
    if (mode === "off") return [];
    const { unsetHolidaysAhead } = await import("@/lib/bank-holidays");
    const { holidayQuestion, usualHoursOn } = await import("@/lib/bank-holiday-rules");
    const flags = await unsetHolidaysAhead(restaurant.special_hours, today);
    const asked: string[] = [];
    for (const flag of flags) {
      const question = holidayQuestion(flag, usualHoursOn(restaurant.opening_hours, flag.date));
      // Each holiday is only flagged once (the job key is also unique in the database).
      const key = `visibility:holiday:${flag.date}`;
      const seen = ok(await getSupabase().from("agent_jobs").select("id").eq("restaurant_id", restaurant.id).eq("job_key", key).maybeSingle<{ id: string }>());
      if (seen) continue;
      const jobId = await recordAgentRun({
        restaurantId: restaurant.id,
        key,
        agent: "visibility",
        kind: mode === "live" ? "visibility_live" : "visibility_shadow",
        trigger: "weekly_plan_monday",
        output: { outcome: "question", holiday: flag, question },
        agentVersion: "code",
        verdict: "question",
      });
      if (!jobId) continue;
      if (mode === "live") {
        await createDraft({
          restaurantId: restaurant.id,
          kind: "hours_question",
          content: question,
          audience: `${flag.title} hours`,
          request: "Bank holiday coming up with no special hours set",
          checks: {},
          mode: "hold",
          actor: "visibility",
          agentInput: { date: flag.date, title: flag.title },
        });
      } else {
        ok(
          await getSupabase().from("shadow_drafts").insert({
            restaurant_id: restaurant.id,
            agent: "visibility",
            agent_version: "code",
            checker_version: null,
            job_id: jobId,
            source: "bank_holiday",
            task: "special_hours",
            subject: { holiday: flag },
            legacy_draft_id: null,
            legacy_text: null,
            outcome: "question",
            output: null,
            question,
            checker: null,
            revisions: 0,
            steps: [],
          }),
        );
      }
      asked.push(flag.title);
    }
    const brief: VisibilityJob = { task: "content_brief" };
    const key = `visibility:brief:${today}`;
    if (mode === "live") await queueVisibilityLive(restaurant, brief, key);
    else await queueVisibilityShadow(restaurant, brief, key);
    return asked;
  } catch (err) {
    console.error("Visibility's Monday steps failed", err);
    return [];
  }
}
