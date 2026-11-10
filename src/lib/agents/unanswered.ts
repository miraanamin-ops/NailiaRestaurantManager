import "server-only";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import type { UnansweredReason } from "./help-rules";

// Owner messages the assistant couldn't answer (unanswered_questions, 063): every
// off-topic message, blocked reply, question the help guide doesn't cover, and
// message nothing could handle. The admin console shows them. Never throws.

export async function logUnanswered(input: { restaurantId: string; sender: string | null; message: string; route: string | null; reason: UnansweredReason; detail?: string | null; emailedSupport?: boolean }) {
  const res = await getSupabase()
    .from("unanswered_questions")
    .insert({
      restaurant_id: input.restaurantId,
      sender: input.sender,
      message: input.message.slice(0, 2000),
      route: input.route,
      reason: input.reason,
      detail: input.detail?.slice(0, 2000) ?? null,
      emailed_support_at: input.emailedSupport ? new Date().toISOString() : null,
    })
    .then((r) => r, (err: unknown) => ({ error: { message: String(err) } }));
  if (res.error) console.error("Couldn't log an unanswered question", res.error.message);
}

export const supportEmail = (env: Record<string, string | undefined> = process.env) => env.SUPPORT_EMAIL?.trim() || "support@dinerai.co.uk";

// A product question the guide doesn't cover: emailed to support (and the owner told). false if it couldn't be sent.
export async function emailSupport(r: Pick<Restaurant, "id" | "name" | "slug" | "owner_name" | "owner_email">, sender: string | null, question: string) {
  try {
    const { sendBuilderEmail } = await import("@/lib/email");
    await sendBuilderEmail(
      supportEmail(),
      `Owner question not in the help guide: ${r.name}`,
      [
        `${r.owner_name ?? "The owner"} of ${r.name} (${r.slug ?? r.id}) asked on WhatsApp, and the help guide (agents/help.md) doesn't cover it:`,
        "",
        `"${question}"`,
        "",
        `Reply to them on WhatsApp${sender ? ` (${sender.replace(/^whatsapp:/, "")})` : ""}${r.owner_email ? ` or by email (${r.owner_email})` : ""}, and add the answer to agents/help.md so next time it's answered straight away.`,
      ].join("\n"),
    );
    return true;
  } catch (err) {
    console.error("Couldn't email support", err);
    return false;
  }
}

export type UnansweredRow = { id: string; restaurant_id: string; created_at: string; message: string; route: string | null; reason: UnansweredReason; detail: string | null; emailed_support_at: string | null };

// The admin console (builder only): counts by reason (last 7 days and all time) and the latest 20, every restaurant.
export async function unansweredForAdmin(now = new Date()) {
  const supabase = getSupabase();
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const [latest, all, names] = await Promise.all([
    supabase.from("unanswered_questions").select("id, restaurant_id, created_at, message, route, reason, detail, emailed_support_at").order("created_at", { ascending: false }).limit(20).returns<UnansweredRow[]>(),
    supabase.from("unanswered_questions").select("restaurant_id, reason, created_at").order("created_at", { ascending: false }).limit(5000).returns<{ restaurant_id: string; reason: UnansweredReason; created_at: string }[]>(),
    supabase.from("restaurants").select("id, name").returns<{ id: string; name: string }[]>(),
  ]);
  for (const r of [latest, all, names]) if (r.error) throw new Error(r.error.message);
  const counts = new Map<string, { week: number; total: number }>();
  for (const row of all.data ?? []) {
    const c = counts.get(row.reason) ?? { week: 0, total: 0 };
    c.total++;
    if (row.created_at >= since) c.week++;
    counts.set(row.reason, c);
  }
  const nameOf = new Map((names.data ?? []).map((r) => [r.id, r.name]));
  return { counts: [...counts.entries()].map(([reason, c]) => ({ reason, ...c })), latest: (latest.data ?? []).map((row) => ({ ...row, restaurant: nameOf.get(row.restaurant_id) ?? "?" })) };
}
