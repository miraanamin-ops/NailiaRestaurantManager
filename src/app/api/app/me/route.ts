import type { NextRequest } from "next/server";
import { appJson, withOwner } from "@/lib/app-api";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";

// Who is logged in to the app and which restaurants they can see (the builder sees all).
export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const rows = owner.restaurantIds.length
      ? (check(
          await getSupabase()
            .from("restaurants")
            .select("id, name, owner_name, active")
            .in("id", owner.restaurantIds)
            .order("created_at")
            .returns<{ id: string; name: string; owner_name: string | null; active: boolean | null }[]>(),
        ) ?? [])
      : [];
    const mine = rows.find((r) => r.owner_name) ?? rows[0];
    const firstName = (mine?.owner_name ?? "").trim().split(/\s+/)[0] || null;
    return appJson({
      email: owner.email,
      firstName: owner.isBuilder ? null : firstName,
      isBuilder: owner.isBuilder,
      restaurants: rows.map((r) => ({ id: r.id, name: r.name, active: Boolean(r.active) })),
    });
  });
}
