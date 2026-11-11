import "server-only";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { rotaUrl } from "@/lib/rota/build";
import { getSupabase, restaurantNow, type Restaurant } from "@/lib/supabase";
import { addDays, appRotaWeek, mondayOf, todayOnRota, type RotaWeekLike } from "./rota-rules";

// The rota in the app: this week and next from rota_weeks (the saved plans), and
// today's shifts for the Today tab. Read only: changes are made in words in Chat
// ("Ali can't do Friday"), and the suggestion is approved in the Inbox, as on WhatsApp.

async function weeks(restaurantId: string, starts: string[]) {
  return (
    check(
      await getSupabase()
        .from("rota_weeks")
        .select("week_start, status, summary, draft_id, share_token")
        .eq("restaurant_id", restaurantId)
        .in("week_start", starts)
        .returns<RotaWeekLike[]>(),
    ) ?? []
  );
}

const target = (r: Restaurant) => (r.labour_target_pct == null ? null : Number(r.labour_target_pct) || null);

export async function rotaWeeksFor(r: Restaurant) {
  const today = londonYmd(restaurantNow(r));
  const thisWeek = mondayOf(today);
  const nextWeek = addDays(thisWeek, 7);
  const rows = await weeks(r.id, [thisWeek, nextWeek]);
  const view = (start: string) => {
    const w = appRotaWeek(rows.find((x) => x.week_start === start) ?? null, start, target(r));
    return { ...w, shareUrl: w.shareToken ? rotaUrl(w.shareToken) : null };
  };
  return { today, thisWeek: view(thisWeek), nextWeek: view(nextWeek) };
}

export async function rotaToday(r: Restaurant) {
  const today = londonYmd(restaurantNow(r));
  const start = mondayOf(today);
  const [row] = await weeks(r.id, [start]);
  return todayOnRota(appRotaWeek(row ?? null, start, target(r)), today);
}
