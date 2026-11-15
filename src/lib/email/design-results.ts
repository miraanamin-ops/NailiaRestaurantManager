import "server-only";
import { check } from "@/lib/drafts";
import { selectAll } from "@/lib/sales/store";
import { getSupabase } from "@/lib/supabase";
import { LOOKS, type EmailDesign } from "./designs";
import { lookResults, photoInsight, weakLooks, type SendRow } from "./design-results-rules";

// How the email designs do (rules in ./design-results-rules.ts): each restaurant's own
// line for the Monday report, the builder's table on /admin/emails, and which look (if
// any) leaves the turns. Only real emails count: sent to a customer by email, not the
// owner's copy and not simulated.

const DAY = 86_400_000;

export async function sendRowsFor(restaurantId: string, since: Date): Promise<SendRow[]> {
  const campaigns =
    check(
      await getSupabase()
        .from("campaigns")
        .select("id, email_design")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", since.toISOString())
        .not("email_design", "is", null)
        .returns<{ id: string; email_design: EmailDesign | null }[]>(),
    ) ?? [];
  const design = new Map(campaigns.filter((c) => c.email_design).map((c) => [c.id, c.email_design!]));
  if (!design.size) return [];
  const sends = await selectAll<{ campaign_id: string; opened_at: string | null; clicked_at: string | null; redeemed_at: string | null }>((from, to) =>
    getSupabase()
      .from("campaign_sends")
      .select("campaign_id, opened_at, clicked_at, redeemed_at")
      .eq("restaurant_id", restaurantId)
      .in("campaign_id", [...design.keys()])
      .eq("kind", "customer")
      .eq("delivery", "email")
      .range(from, to),
  );
  return sends.map((s) => {
    const d = design.get(s.campaign_id)!;
    return { campaign_id: s.campaign_id, family: d.family, look: d.look, photo: Boolean(d.photo_url), opened: Boolean(s.opened_at), clicked: Boolean(s.clicked_at), redeemed: Boolean(s.redeemed_at) };
  });
}

// The Monday report's line about photos (last 6 months), or null until it's real.
export async function photoLineFor(restaurantId: string, now: Date) {
  return photoInsight(await sendRowsFor(restaurantId, new Date(now.getTime() - 182 * DAY)));
}

// Every restaurant's last year together, one restaurant at a time (each query keeps to
// one restaurant). Kept for 6 hours: campaigns are drafted a few times a week.
let pooled: { at: number; rows: SendRow[] } | null = null;
export async function allSendRows(now = new Date()): Promise<SendRow[]> {
  if (pooled && now.getTime() - pooled.at < 6 * 3600_000) return pooled.rows;
  const ids = (check(await getSupabase().from("restaurants").select("id").returns<{ id: string }[]>()) ?? []).map((r) => r.id);
  const rows: SendRow[] = [];
  for (const id of ids) rows.push(...(await sendRowsFor(id, new Date(now.getTime() - 365 * DAY))));
  pooled = { at: now.getTime(), rows };
  return rows;
}

// Looks that clearly do worse than the rest of their family: skipped in the turns.
export async function lookToSkip(now = new Date()) {
  return weakLooks(await allSendRows(now), LOOKS);
}

export async function designResults(now = new Date()) {
  const rows = await allSendRows(now);
  return { looks: lookResults(rows), photo: photoInsight(rows), skipped: weakLooks(rows, LOOKS), emails: rows.length };
}
