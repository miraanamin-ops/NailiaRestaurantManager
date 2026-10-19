"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentOwner } from "@/lib/auth";
import { cleanMenu } from "@/lib/onboarding/menu-input";
import { DAYS, parseHoursText, type Hours } from "@/lib/onboarding/profile-data";
import { getRestaurant } from "@/lib/onboarding/store";
import { validHex } from "@/lib/email/brand";
import { isEmail } from "@/lib/email/route";
import { isSupportedImage, saveLogo } from "@/lib/photos";
import { menuWithIds } from "@/lib/ops/menu";
import { revertProfileChange, saveProfileFields } from "@/lib/profile-edits";
import type { AgentName } from "@/lib/agents/definition";
import { goLiveChecklistFor, promptOwnerForGoLive } from "@/lib/agents/go-live";
import { GO_LIVE_FIELDS } from "@/lib/profile/fields";
import { agentMode, MODES_AVAILABLE } from "@/lib/agents/modes";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { entryProblems } from "@/lib/local-calendar-rules";
import { OFFER_TYPES } from "@/lib/offers";
import { createPortalSession } from "@/lib/billing/checkout";
import { baseUrlFrom, getSupabase } from "@/lib/supabase";
import { ALWAYS_APPROVE, NEVER_AUTO, TASK_LABELS, TASKS, TRUST_LEVELS, trustLevel } from "@/lib/trust";

// The settings page's save buttons. Every change is logged (UNDO on WhatsApp puts it back).

async function own(restaurantId: string) {
  const owner = await currentOwner();
  if (!owner) redirect(`/login?next=${encodeURIComponent(`/settings?r=${restaurantId}`)}`);
  if (!owner.restaurantIds.includes(restaurantId)) throw new Error("Not your restaurant");
  return getRestaurant(restaurantId);
}

const back = (rid: string, params: string): never => redirect(`/settings?r=${rid}&${params}`);

export async function saveDetails(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const r = await own(get("r"));

  const hours: Hours = {};
  const unclear: string[] = [];
  for (const day of DAYS) {
    const typed = get(`hours_${day}`);
    if (!typed) continue;
    const value = parseHoursText(typed);
    if (value) hours[day] = value;
    else unclear.push(day);
  }
  if (unclear.length) back(r.id, `error=${encodeURIComponent(`Couldn't read the hours for ${unclear.join(", ")}. Try e.g. 12:00 – 22:00, or Closed.`)}`);

  const cap = Number(get("cap"));
  if (!(cap >= 0 && cap <= 100)) back(r.id, `error=${encodeURIComponent("The discount cap needs to be between 0 and 100.")}`);
  const website = get("website");
  const offerTypes = OFFER_TYPES.filter((t) => form.get(`offer_${t}`) === "yes");
  await saveProfileFields(
    r,
    {
      opening_hours: hours,
      phone: get("phone") || null,
      address: get("address") || null,
      website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
      signup_reward: get("reward").slice(0, 100) || null,
      discount_cap_percent: Math.round(cap),
      approved_offer_types: offerTypes,
      birthday_offer: get("birthday_offer").slice(0, 100) || null,
    },
    "Changed in settings",
  );
  back(r.id, "saved=details");
}

// Logo, colours, tagline and email settings (how customer emails look and behave).
export async function saveBrand(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const r = await own(get("r"));
  const color = validHex(get("brand_color"));
  const dark = validHex(get("brand_dark"));
  if (!color || !dark) back(r.id, `error=${encodeURIComponent("Colours need to look like #c2410c.")}`);
  const replyTo = get("reply_to_email");
  if (replyTo && !isEmail(replyTo)) back(r.id, `error=${encodeURIComponent("That reply-to email doesn't look right.")}`);

  let logoUrl = form.get("remove_logo") === "yes" ? null : r.logo_url;
  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!isSupportedImage(logo.type)) back(r.id, `error=${encodeURIComponent("The logo needs to be a PNG, JPEG, GIF or WebP image (email apps don't show SVG).")}`);
    try {
      logoUrl = await saveLogo(r.id, Buffer.from(await logo.arrayBuffer()), logo.type as Parameters<typeof saveLogo>[2]);
    } catch (err) {
      back(r.id, `error=${encodeURIComponent(err instanceof Error ? err.message : "Couldn't save the logo.")}`);
    }
  }
  await saveProfileFields(
    r,
    {
      logo_url: logoUrl,
      brand_color: color!,
      brand_dark: dark!,
      tagline: get("tagline").slice(0, 80) || null,
      reply_to_email: replyTo ? replyTo.toLowerCase() : null,
      feedback_emails: form.get("feedback_emails") === "yes",
    },
    "Changed email branding in settings",
  );
  back(r.id, "saved=brand");
}

// How replies and messages sound: the profile fields the agents use for wording,
// food statements, complaints and recovery offers.
export async function saveVoice(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const r = await own(get("r"));
  const lines = (k: string) =>
    get(k)
      .split(/\n|,/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 20);
  const emojis = (k: string) => Math.min(5, Math.max(0, Math.round(Number(get(k)) || 0)));
  await saveProfileFields(
    r,
    {
      sign_off_name: get("sign_off_name").slice(0, 60) || null,
      greeting: get("greeting").slice(0, 40) || null,
      complaint_contact: get("complaint_contact").slice(0, 120) || null,
      halal_statement: get("halal_statement").slice(0, 500) || null,
      allergen_statement: get("allergen_statement").slice(0, 500) || null,
      recovery_offers: lines("recovery_offers").map((l) => l.slice(0, 120)),
      words_to_avoid: lines("words_to_avoid").map((l) => l.slice(0, 40)),
      emoji_allowed: { review_replies: emojis("emoji_review_replies"), posts: emojis("emoji_posts"), campaigns: emojis("emoji_campaigns") },
    },
    "Changed in settings",
  );
  back(r.id, "saved=voice");
}

// About the owner: their name, the language messages to them are written in, and
// their quiet hours (no alerts between these times, UK time; can run over midnight).
export async function saveOwner(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const r = await own(get("r"));
  const start = get("quiet_hours_start");
  const end = get("quiet_hours_end");
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!TIME.test(start) || !TIME.test(end)) back(r.id, `error=${encodeURIComponent("Quiet hours need a start and an end time, e.g. 23:00 and 09:00.")}`);
  if (start === end) back(r.id, `error=${encodeURIComponent("Quiet hours need to start and end at different times.")}`);
  // Postgres gives times back as "23:00:00"; saving the same time the other way isn't a change.
  const sameTime = (a: string | null, b: string) => (a ?? "").slice(0, 5) === b;
  await saveProfileFields(
    r,
    {
      owner_name: get("owner_name").slice(0, 60) || null,
      owner_language: get("owner_language").slice(0, 60) || "English",
      ...(sameTime(r.quiet_hours_start, start) ? {} : { quiet_hours_start: start }),
      ...(sameTime(r.quiet_hours_end, end) ? {} : { quiet_hours_end: end }),
    },
    "Changed in settings",
  );
  back(r.id, "saved=owner");
}

// Builder controls: trust level per task and each agent's mode. Only the builder
// (BUILDER_EMAIL) can change these; owners never see them. Logged as the builder,
// so the owner's UNDO never reverses them.
export async function saveBuilderControls(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const owner = await currentOwner();
  if (!owner?.isBuilder) throw new Error("Only the builder can change these");
  const r = await own(get("r"));
  const trust: Record<string, string> = {};
  for (const task of TASKS) {
    const level = get(`trust_${task}`);
    if (!(TRUST_LEVELS as readonly string[]).includes(level)) continue;
    // Never-Auto tasks can't be stored as Auto (the gate ignores it anyway).
    trust[task] = ALWAYS_APPROVE.has(task) || (level === "auto" && NEVER_AUTO.has(task)) ? "approve" : level;
  }
  const modes: Record<string, string> = { ...(r.agent_modes ?? {}) };
  const blocked: string[] = [];
  for (const [agent, available] of Object.entries(MODES_AVAILABLE)) {
    const mode = get(`mode_${agent}`);
    if (!(available.allowed as string[]).includes(mode)) continue;
    // Go-live checklist: an agent can't go live until the fields it needs are filled.
    const checklist = await goLiveChecklistFor(r, agent as AgentName);
    if (mode === "live" && !checklist.ready) {
      blocked.push(`${agent} can't go live yet: missing ${checklist.labels.join(", ")}`);
      const prompted = await promptOwnerForGoLive(r, agent as AgentName);
      if (prompted) blocked.push("the owner has been sent a WhatsApp asking for them");
      continue;
    }
    modes[agent] = mode;
  }
  check(await getSupabase().from("restaurants").update({ trust_levels: trust, agent_modes: modes }).eq("id", r.id));
  // Each change named in the log line ("growth: shadow → live").
  const changes = [
    ...Object.keys(MODES_AVAILABLE)
      .filter((a) => agentMode({ agent_modes: modes }, a as AgentName) !== agentMode(r, a as AgentName))
      .map((a) => `${a}: ${agentMode(r, a as AgentName)} → ${agentMode({ agent_modes: modes }, a as AgentName)}`),
    ...TASKS.filter((t) => trustLevel(trust, t) !== trustLevel(r.trust_levels, t)).map((t) => `${TASK_LABELS[t]}: ${trustLevel(r.trust_levels, t)} → ${trustLevel(trust, t)}`),
  ];
  await logAction({
    restaurantId: r.id,
    actor: "builder",
    action: "setting",
    detail: `Changed trust levels and agent modes (builder controls)${changes.length ? `: ${changes.join("; ")}` : ", nothing different"}`,
    data: { field: "builder_controls", before: { trust_levels: r.trust_levels, agent_modes: r.agent_modes }, after: { trust_levels: trust, agent_modes: modes } },
  });
  if (blocked.length) back(r.id, `error=${encodeURIComponent(`Saved, but ${blocked.join("; ")}.`)}`);
  back(r.id, "saved=builder");
}

// Builder only: send the owner the go-live prompt now (still at most once a day).
export async function askOwnerForGoLive(form: FormData) {
  const owner = await currentOwner();
  if (!owner?.isBuilder) throw new Error("Only the builder can do this");
  const r = await own(String(form.get("r") ?? ""));
  // One prompt a day covers one agent: the first one that's missing details.
  let sent = false;
  for (const agent of Object.keys(GO_LIVE_FIELDS) as AgentName[]) {
    if (!sent && !(await goLiveChecklistFor(r, agent)).ready) sent = await promptOwnerForGoLive(r, agent);
  }
  back(r.id, sent ? "saved=asked" : `error=${encodeURIComponent("Not sent: the owner was already asked in the last day, nothing is missing, or their WhatsApp isn't linked yet.")}`);
}

// Revert one profile change (from the profile history list). Not UNDO.
export async function revertProfile(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const r = await own(get("r"));
  const result = await revertProfileChange(r, get("version"));
  if (!result.ok) back(r.id, `error=${encodeURIComponent(result.reason)}`);
  back(r.id, "saved=reverted");
}

export async function saveSettingsMenu(restaurantId: string, menu: unknown) {
  const r = await own(restaurantId);
  // Dishes keep their confirmed allergens unless something about them changed. The
  // editor sends each dish's id, so a renamed dish stays the same dish.
  await saveProfileFields(r, { menu: cleanMenu(menu, await menuWithIds(r.id)) }, "Changed the menu in settings");
  back(r.id, "saved=menu");
}

export async function saveSettingsAllergens(restaurantId: string, menu: unknown) {
  const r = await own(restaurantId);
  const confirmed = cleanMenu(menu).map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, allergens_confirmed: true })) }));
  await saveProfileFields(r, { menu: confirmed }, "Confirmed allergens in settings");
  back(r.id, "saved=allergens");
}

// Builder only: add a date to the local calendar (this restaurant, or every restaurant).
// Logged as the builder, so the owner's UNDO never reverses it.
export async function addCalendarEntry(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const owner = await currentOwner();
  if (!owner?.isBuilder) throw new Error("Only the builder can change the calendar");
  const r = await own(get("r"));
  const entry = { day: get("day"), name: get("name").slice(0, 80), type: get("type") };
  const problems = entryProblems(entry);
  if (problems.length) back(r.id, `error=${encodeURIComponent(`The calendar date needs ${problems.join(", ")}.`)}`);
  const shared = get("scope") === "all";
  const { error } = await getSupabase()
    .from("local_calendar")
    .insert({ restaurant_id: shared ? null : r.id, ...entry, date_uncertain: form.get("uncertain") === "yes", source: "builder" });
  if (error) back(r.id, `error=${encodeURIComponent(error.code === "23505" ? "That date is already in the calendar." : error.message)}`);
  await logAction({ restaurantId: r.id, actor: "builder", action: "setting", detail: `Added ${entry.name} (${entry.day}) to the local calendar${shared ? " for every restaurant" : ""}`, data: { field: "local_calendar", after: entry } });
  back(r.id, "saved=calendar");
}

// Builder only: remove a date the builder added (gov.uk bank holidays stay).
export async function removeCalendarEntry(form: FormData) {
  const get = (k: string) => String(form.get(k) ?? "").trim();
  const owner = await currentOwner();
  if (!owner?.isBuilder) throw new Error("Only the builder can change the calendar");
  const r = await own(get("r"));
  const removed = check(
    await getSupabase()
      .from("local_calendar")
      .delete()
      .eq("id", get("id"))
      .or(`restaurant_id.eq.${r.id},restaurant_id.is.null`)
      .eq("source", "builder")
      .select("day, name")
      .returns<{ day: string; name: string }[]>(),
  );
  if (removed?.length) await logAction({ restaurantId: r.id, actor: "builder", action: "setting", detail: `Removed ${removed[0].name} (${removed[0].day}) from the local calendar`, data: { field: "local_calendar", before: removed[0] } });
  back(r.id, "saved=calendar");
}

// "Manage billing": Stripe's own page to update the card, see invoices or cancel
// (a cancellation takes effect at the end of the paid month; set in Stripe's portal settings).
export async function openBilling(form: FormData) {
  const restaurantId = String(form.get("r") ?? "");
  const r = await own(restaurantId);
  let url: string | null = null;
  try {
    url = await createPortalSession(r, `${baseUrlFrom(await headers())}/settings?r=${restaurantId}`);
  } catch (err) {
    console.error("Couldn't open the billing portal", err);
  }
  if (!url) redirect(`/settings?r=${restaurantId}&error=${encodeURIComponent("Couldn't open billing just now. Please try again.")}`);
  await logAction({ restaurantId, actor: "owner", action: "billing", detail: "Opened Manage billing" });
  redirect(url!);
}
