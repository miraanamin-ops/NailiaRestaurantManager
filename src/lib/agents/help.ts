import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { londonYmd } from "@/lib/clock";
import { appUrl, getSupabase, type Restaurant } from "@/lib/supabase";
import { setupLines, type SetupFacts } from "./help-rules";

// The owner's help guide (agents/help.md, bundled with the agent files by
// next.config.ts) and "your setup": a few facts about this restaurant, from code,
// so a "how do I...?" answer can be personal ("your QR pack is at ...", "Google
// isn't connected yet"). Both are the only sources a help answer may use.

let guide: string | null = null;

export function helpGuide() {
  guide ??= readFileSync(join(process.cwd(), "agents", "help.md"), "utf8");
  return guide;
}

const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
  const res = await q;
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
};

export async function setupFacts(r: Restaurant, now: Date): Promise<SetupFacts> {
  const supabase = getSupabase();
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const [customers, emailable, salesDays, itemDays, staffPhones] = await Promise.all([
    count(supabase.from("customers").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).is("deleted_at", null)),
    count(
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", r.id)
        .eq("marketing_opt_in", true)
        .is("unsubscribed_at", null)
        .is("deleted_at", null)
        .not("email_confirmed_at", "is", null),
    ),
    count(supabase.from("sales_days").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).eq("is_dummy", false).gte("day", since)),
    count(supabase.from("sales_items").select("day", { count: "exact", head: true }).eq("restaurant_id", r.id).eq("is_dummy", false).gte("day", since)),
    count(supabase.from("staff_numbers").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).is("removed_at", null)).catch(() => 0),
  ]);
  const dishes = (r.menu ?? []).flatMap((c) => c.items) as { cost?: number | null; allergens?: string[]; allergens_confirmed?: boolean }[];
  const base = appUrl();
  return {
    google_connected: Boolean((r as Restaurant & { google_location_id?: string | null }).google_location_id),
    customers,
    emailable_customers: emailable,
    signup_page: r.slug ? `${base}/r/${r.slug}` : null,
    qr_card: r.slug ? `${base}/r/${r.slug}/qr` : null,
    qr_pack: r.slug ? `${base}/r/${r.slug}/qr-pack` : null,
    signup_reward: r.signup_reward,
    discount_cap_percent: r.discount_cap_percent,
    send_window: `${r.send_window_start.slice(0, 5)} to ${r.send_window_end.slice(0, 5)}`,
    paused: r.paused,
    sales_days_last_30: salesDays,
    item_sales_last_30: itemDays > 0,
    dishes: dishes.length,
    dishes_with_costs: dishes.filter((d) => typeof d.cost === "number").length,
    allergens_to_confirm: dishes.filter((d) => d.allergens?.length && !d.allergens_confirmed).length,
    staff_phones: staffPhones,
    today: londonYmd(now),
  };
}

export async function yourSetup(r: Restaurant, now: Date) {
  return setupLines(await setupFacts(r, now));
}
