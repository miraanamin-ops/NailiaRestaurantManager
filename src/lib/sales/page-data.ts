import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";
import { addDays } from "./format";
import { recentImports } from "./pos-import";
import { listStaff } from "./staff";
import { signedFileUrl } from "./store";
import type { ZRow } from "./z-reports";

// Everything the owner's sales page shows, for one restaurant.
export async function salesPageData(restaurantId: string, now = new Date()) {
  const supabase = getSupabase();
  const today = londonYmd(now);
  const [zRes, daysRes, weatherCount, weatherLast, imports, staff] = await Promise.all([
    supabase
      .from("z_reports")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .in("status", ["saved", "needs_confirm", "needs_date", "needs_replace", "unreadable"])
      .order("created_at", { ascending: false })
      .limit(14)
      .returns<ZRow[]>(),
    supabase
      .from("sales_days")
      .select("day, net_sales, transactions, source, is_dummy, net_estimated")
      .eq("restaurant_id", restaurantId)
      .gte("day", addDays(today, -14))
      .order("day", { ascending: false })
      .returns<{ day: string; net_sales: number; transactions: number | null; source: string; is_dummy: boolean; net_estimated: boolean }[]>(),
    supabase.from("weather_days").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId),
    supabase
      .from("weather_days")
      .select("day, temp_max, rain_mm, conditions")
      .eq("restaurant_id", restaurantId)
      .lt("day", today)
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle<{ day: string; temp_max: number | null; rain_mm: number | null; conditions: string | null }>(),
    recentImports(restaurantId, 8),
    listStaff(restaurantId),
  ]);
  const zReports = check(zRes) ?? [];
  const photos = await Promise.all(zReports.map((z) => (z.photo_path ? signedFileUrl(z.photo_path) : Promise.resolve(null))));
  if (weatherCount.error) throw new Error(weatherCount.error.message);
  return {
    zReports: zReports.map((z, i) => ({ ...z, photoUrl: photos[i] })),
    days: check(daysRes) ?? [],
    weather: { days: weatherCount.count ?? 0, last: check(weatherLast) },
    imports,
    staff,
  };
}
