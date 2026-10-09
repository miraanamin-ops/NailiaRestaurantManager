import "server-only";
import { londonTime, londonYmd } from "@/lib/clock";
import type { DraftChecks } from "@/lib/checks/types";
import { check, checkRow, createDraft, applyEdit, type Draft } from "@/lib/drafts";
import { sendCampaignEmail } from "@/lib/email";
import { newToken } from "@/lib/signups";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";

// Email campaigns. Everything here is plain code: who is in a segment, who
// has consent, what gets sent for real vs simulated, and when an offer is valid.

export const SEGMENTS = ["everyone", "birthdays_7d", "unredeemed_signups"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<Segment, string> = {
  everyone: "Everyone",
  birthdays_7d: "Birthdays in the next 7 days",
  unredeemed_signups: "New sign-ups who haven't used their welcome reward",
};

export type CampaignFields = {
  name: string;
  subject: string;
  body: string;
  offer: string;
  valid_from: string; // YYYY-MM-DD, London
  valid_until: string;
  segment: Segment;
};

export type Campaign = CampaignFields & {
  id: string;
  restaurant_id: string;
  draft_id: string;
  is_birthday: boolean;
  sent_at: string | null;
  eligible_count: number | null;
  excluded_count: number | null;
  created_at: string;
};

export type CampaignSend = {
  id: string;
  campaign_id: string;
  restaurant_id: string;
  customer_id: string | null;
  email: string;
  token: string;
  kind: "customer" | "owner_copy";
  delivery: "email" | "simulated" | "failed";
  opened_at: string | null;
  clicked_at: string | null;
  redeemed_at: string | null;
  expires_at: string | null;
};

type SegmentCustomer = {
  id: string;
  name: string;
  email: string | null;
  birthday: string | null;
  marketing_opt_in: boolean;
  unsubscribed_at: string | null;
  source: string;
};

// ---------- Dates (London) ----------

function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function formatDay(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function formatValidity(from: string, until: string) {
  return from === until ? `${formatDay(from)} only` : `${formatDay(from)} – ${formatDay(until)}`;
}

// Makes the AI's dates safe: real dates, not in the past, at most 31 days long.
export function normaliseDates(from: string, until: string, now: Date) {
  const today = londonYmd(now);
  const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  let f = isDate(from) ? from : today;
  if (f < today) f = today;
  let u = isDate(until) ? until : f;
  if (u < f) u = f;
  if (u > addDays(f, 31)) u = addDays(f, 31);
  return { valid_from: f, valid_until: u };
}

// The birthday email's offer: today plus the next 6 days (7 days in total).
export function birthdayWeek(now: Date) {
  const today = londonYmd(now);
  return { valid_from: today, valid_until: addDays(today, 6) };
}

// The 14 days ahead as "Thu 15 Oct = 2026-10-15", so the AI gets dates right.
export function upcomingCalendar(now: Date) {
  const today = londonYmd(now);
  return Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today, i);
    return `${formatDay(d)} = ${d}${i === 0 ? " (today)" : ""}`;
  }).join("\n");
}

export type OfferValidity = "not_yet" | "ok" | "ended";

// Offers are valid from 00:00 on valid_from to 23:59 on valid_until, London time.
export function offerValidity(campaign: Pick<Campaign, "valid_from" | "valid_until">, now: Date): OfferValidity {
  const [fy, fm, fd] = campaign.valid_from.split("-").map(Number);
  const end = addDays(campaign.valid_until, 1);
  const [ey, em, ed] = end.split("-").map(Number);
  if (now < londonTime(fy, fm, fd, 0, 0)) return "not_yet";
  if (now >= londonTime(ey, em, ed, 0, 0)) return "ended";
  return "ok";
}

// ---------- Segments and consent ----------

function hasBirthdayInNext7Days(birthday: string | null, now: Date) {
  if (!birthday) return false;
  const md = birthday.slice(5); // "MM-DD"
  const today = londonYmd(now);
  for (let i = 0; i < 7; i++) if (addDays(today, i).slice(5) === md) return true;
  return false;
}

// Everyone in the segment, then split by consent. Only `eligible` are emailed.
// Plain code (no database), so it's unit-tested. unredeemedIds: customers whose
// welcome reward is still unused (for the "unredeemed_signups" segment).
export function segmentRecipients(customers: SegmentCustomer[], segment: Segment, now: Date, unredeemedIds: Set<string>) {
  let inSegment = customers.filter((c) => c.email);
  if (segment === "birthdays_7d") inSegment = inSegment.filter((c) => hasBirthdayInNext7Days(c.birthday, now));
  else if (segment === "unredeemed_signups") inSegment = inSegment.filter((c) => c.source === "signup" && unredeemedIds.has(c.id));

  // Safety rule: only customers with valid consent who haven't unsubscribed.
  const eligible = inSegment.filter((c) => c.marketing_opt_in && !c.unsubscribed_at);
  return { eligible, excluded: inSegment.length - eligible.length };
}

export async function recipientsFor(restaurant: Restaurant, segment: Segment, now: Date) {
  const supabase = getSupabase();
  const customers =
    check(
      await supabase
        .from("customers")
        .select("id, name, email, birthday, marketing_opt_in, unsubscribed_at, source")
        .eq("restaurant_id", restaurant.id)
        .returns<SegmentCustomer[]>(),
    ) ?? [];
  let unredeemed: { customer_id: string }[] = [];
  if (segment === "unredeemed_signups") {
    unredeemed =
      check(
        await supabase
          .from("rewards")
          .select("customer_id")
          .eq("restaurant_id", restaurant.id)
          .is("redeemed_at", null)
          .returns<{ customer_id: string }[]>(),
      ) ?? [];
  }
  return segmentRecipients(customers, segment, now, new Set(unredeemed.map((r) => r.customer_id)));
}

// Every customer email needs an unsubscribe link. Customers who don't have an
// unsubscribe token yet (e.g. added before sign-ups existed) get one now.
// Returns how many still have none (0 unless the database refused).
export async function ensureUnsubscribeTokens(customerIds: string[]) {
  if (!customerIds.length) return 0;
  const supabase = getSupabase();
  const missing =
    check(
      await supabase.from("customers").select("id").in("id", customerIds).is("unsubscribe_token", null).returns<{ id: string }[]>(),
    ) ?? [];
  let failed = 0;
  for (const c of missing) {
    const { error } = await supabase.from("customers").update({ unsubscribe_token: newToken() }).eq("id", c.id);
    if (error) failed++;
  }
  return failed;
}

export function audienceLabel(segment: Segment, eligible: number) {
  return `${SEGMENT_LABELS[segment]} (${eligible} with consent)`;
}

// ---------- Drafts ----------

// What the owner sees on WhatsApp, and what the safety rules check (e.g. the discount cap).
export function campaignPreviewText(f: CampaignFields) {
  return `*${f.name}*\n*Subject:* ${f.subject}\n\n${f.body}\n\n🎁 *Offer:* ${f.offer}\n📅 *Valid:* ${formatValidity(f.valid_from, f.valid_until)}`;
}

export async function createCampaignDraft(input: {
  restaurant: Restaurant;
  fields: CampaignFields;
  request: string;
  checks: DraftChecks;
  now: Date;
  isBirthday?: boolean;
  mode?: "present" | "hold";
}) {
  const { eligible } = await recipientsFor(input.restaurant, input.fields.segment, input.now);
  const draft = await createDraft({
    restaurantId: input.restaurant.id,
    kind: "email_campaign",
    content: campaignPreviewText(input.fields),
    audience: audienceLabel(input.fields.segment, eligible.length),
    request: input.request,
    checks: input.checks,
    mode: input.mode,
  });
  const campaign = checkRow(
    await getSupabase()
      .from("campaigns")
      .insert({ restaurant_id: input.restaurant.id, draft_id: draft.id, is_birthday: input.isBirthday ?? false, ...input.fields })
      .select("*")
      .single<Campaign>(),
  );
  return { draft, campaign };
}

export async function getCampaignForDraft(draftId: string) {
  return check(await getSupabase().from("campaigns").select("*").eq("draft_id", draftId).maybeSingle<Campaign>());
}

// An edit: update the structured campaign and the preview the rules check.
export async function updateCampaignDraft(input: {
  restaurant: Restaurant;
  draft: Draft;
  campaign: Campaign;
  fields: CampaignFields;
  instruction: string;
  checks: DraftChecks;
  now: Date;
}) {
  const { eligible } = await recipientsFor(input.restaurant, input.fields.segment, input.now);
  check(
    await getSupabase()
      .from("campaigns")
      .update({ ...input.fields, updated_at: new Date().toISOString() })
      .eq("id", input.campaign.id),
  );
  const updated = await applyEdit(input.draft, input.instruction, campaignPreviewText(input.fields), input.checks);
  // Keep the audience count current after a segment change.
  return checkRow(
    await getSupabase()
      .from("drafts")
      .update({ audience: audienceLabel(input.fields.segment, eligible.length) })
      .eq("id", updated.id)
      .select("*")
      .single<Draft>(),
  );
}

// ---------- Delivery ----------

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

export type DeliverySummary = { emailed: number; simulated: number; failed: number; excluded: number; ownerCopy: boolean };

// Called by the send pipeline once every safety rule has passed. In test mode
// only the owner's address gets a real email; everyone else is "simulated".
export async function deliverCampaign(draft: Draft, restaurant: Restaurant, now: Date): Promise<DeliverySummary> {
  const supabase = getSupabase();
  const campaign = await getCampaignForDraft(draft.id);
  if (!campaign) throw new Error("Campaign not found for draft");
  const { eligible, excluded } = await recipientsFor(restaurant, campaign.segment, now);
  const ownerEmail = restaurant.owner_email?.toLowerCase() ?? null;

  type Row = { customer_id: string | null; email: string; token: string; kind: "customer" | "owner_copy"; delivery: "email" | "simulated"; name: string; unsubscribeToken: string | null };
  const rows: Row[] = eligible.map((c) => ({
    customer_id: c.id,
    email: c.email!,
    token: newToken(),
    kind: "customer",
    delivery: !restaurant.email_test_mode || c.email === ownerEmail ? "email" : "simulated",
    name: firstName(c.name),
    unsubscribeToken: null,
  }));
  // The owner always gets their own copy to check (and test redeeming).
  if (ownerEmail && !rows.some((r) => r.email === ownerEmail)) {
    rows.push({ customer_id: null, email: ownerEmail, token: newToken(), kind: "owner_copy", delivery: "email", name: "[First name]", unsubscribeToken: null });
  }

  // Insert every row first: the unique index stops any customer getting this campaign twice.
  check(
    await supabase.from("campaign_sends").insert(
      rows.map((r) => ({
        campaign_id: campaign.id,
        restaurant_id: restaurant.id,
        customer_id: r.customer_id,
        email: r.email,
        token: r.token,
        kind: r.kind,
        delivery: r.delivery,
      })),
    ),
  );

  // Unsubscribe links for the real emails.
  const realCustomerIds = rows.filter((r) => r.delivery === "email" && r.customer_id).map((r) => r.customer_id!);
  if (realCustomerIds.length) {
    const tokens =
      check(
        await supabase
          .from("customers")
          .select("id, unsubscribe_token")
          .in("id", realCustomerIds)
          .returns<{ id: string; unsubscribe_token: string | null }[]>(),
      ) ?? [];
    for (const r of rows) r.unsubscribeToken = tokens.find((t) => t.id === r.customer_id)?.unsubscribe_token ?? null;
  }

  let emailed = 0;
  let failed = 0;
  for (const r of rows.filter((x) => x.delivery === "email")) {
    try {
      const resendId = await sendCampaignEmail({
        restaurant,
        campaign,
        validity: formatValidity(campaign.valid_from, campaign.valid_until),
        baseUrl: appUrl(),
        token: r.token,
        to: r.email,
        firstName: r.name,
        unsubscribeToken: r.unsubscribeToken,
        ownerCopy: r.kind === "owner_copy",
      });
      check(await supabase.from("campaign_sends").update({ resend_id: resendId }).eq("token", r.token));
      emailed++;
    } catch (err) {
      failed++;
      check(
        await supabase
          .from("campaign_sends")
          .update({ delivery: "failed", error: err instanceof Error ? err.message : String(err) })
          .eq("token", r.token),
      );
    }
  }

  check(
    await supabase
      .from("campaigns")
      .update({ sent_at: new Date().toISOString(), eligible_count: eligible.length, excluded_count: excluded })
      .eq("id", campaign.id),
  );
  return {
    emailed,
    simulated: rows.filter((r) => r.delivery === "simulated").length,
    failed,
    excluded,
    ownerCopy: rows.some((r) => r.kind === "owner_copy"),
  };
}

export function deliveryNote(s: DeliverySummary) {
  const parts = [`📧 ${s.emailed} real email${s.emailed === 1 ? "" : "s"}${s.ownerCopy ? " (incl. your copy)" : ""}`];
  if (s.simulated) parts.push(`🧪 ${s.simulated} simulated (test mode)`);
  if (s.failed) parts.push(`⚠️ ${s.failed} failed`);
  if (s.excluded) parts.push(`🚫 ${s.excluded} left out (no consent / unsubscribed)`);
  return parts.join(" · ");
}

// ---------- Offer links and tracking ----------

export async function getSendByToken(token: string) {
  const send = check(await getSupabase().from("campaign_sends").select("*").eq("token", token).maybeSingle<CampaignSend>());
  if (!send) return null;
  const campaign = checkRow(await getSupabase().from("campaigns").select("*").eq("id", send.campaign_id).single<Campaign>());
  return { send, campaign };
}

export async function markOpened(token: string) {
  const now = new Date().toISOString();
  await getSupabase().from("campaign_sends").update({ opened_at: now }).eq("token", token).is("opened_at", null);
}

// Opening the offer page counts as a click (and as an open, if images were blocked).
export async function markClicked(token: string) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  await supabase.from("campaign_sends").update({ clicked_at: now }).eq("token", token).is("clicked_at", null);
  await supabase.from("campaign_sends").update({ opened_at: now }).eq("token", token).is("opened_at", null);
}

export const OFFER_REDEEM_MINUTES = 10;

// Starts the 10-minute window, but only while the offer is valid. First tap wins.
export async function redeemOffer(token: string, validityNow: Date) {
  const found = await getSendByToken(token);
  if (!found) return { error: "not_found" as const };
  const validity = offerValidity(found.campaign, validityNow);
  if (!found.send.redeemed_at && validity !== "ok") return { error: validity, ...found };

  const now = new Date();
  const claimed = check(
    await getSupabase()
      .from("campaign_sends")
      .update({ redeemed_at: now.toISOString(), expires_at: new Date(now.getTime() + OFFER_REDEEM_MINUTES * 60_000).toISOString() })
      .eq("token", token)
      .is("redeemed_at", null)
      .select("*")
      .maybeSingle<CampaignSend>(),
  );
  if (claimed) return { justRedeemed: true, send: claimed, campaign: found.campaign };
  const again = await getSendByToken(token);
  return { justRedeemed: false, send: again!.send, campaign: found.campaign };
}

// ---------- Reporting ----------

export type CampaignStats = {
  campaign: Campaign;
  emailed: number;
  simulated: number;
  failed: number;
  excluded: number;
  opened: number;
  clicked: number;
  redeemed: number;
};

export async function campaignStats(campaign: Campaign): Promise<CampaignStats> {
  const sends =
    check(
      await getSupabase()
        .from("campaign_sends")
        .select("delivery, opened_at, clicked_at, redeemed_at")
        .eq("campaign_id", campaign.id)
        .returns<Pick<CampaignSend, "delivery" | "opened_at" | "clicked_at" | "redeemed_at">[]>(),
    ) ?? [];
  return {
    campaign,
    emailed: sends.filter((s) => s.delivery === "email").length,
    simulated: sends.filter((s) => s.delivery === "simulated").length,
    failed: sends.filter((s) => s.delivery === "failed").length,
    excluded: campaign.excluded_count ?? 0,
    opened: sends.filter((s) => s.opened_at).length,
    clicked: sends.filter((s) => s.clicked_at).length,
    redeemed: sends.filter((s) => s.redeemed_at).length,
  };
}

export async function recentCampaignStats(restaurantId: string, limit = 5) {
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
  return Promise.all(campaigns.map(campaignStats));
}

export function statsText(s: CampaignStats) {
  const c = s.campaign;
  return [
    `📊 *${c.name}* (${formatValidity(c.valid_from, c.valid_until)})`,
    `- To: ${SEGMENT_LABELS[c.segment]}`,
    `- Sent: ${s.emailed} real email${s.emailed === 1 ? "" : "s"}${s.simulated ? ` + ${s.simulated} simulated` : ""}${s.excluded ? ` · ${s.excluded} left out (no consent)` : ""}`,
    `- Opened: ${s.opened} · Clicked: ${s.clicked} · Redeemed: ${s.redeemed}`,
    s.simulated ? "_Opens, clicks and redemptions only come from real emails._" : "",
  ]
    .filter(Boolean)
    .join("\n");
}
