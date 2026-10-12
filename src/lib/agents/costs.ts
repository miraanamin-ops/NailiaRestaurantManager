import "server-only";
import { londonYmd } from "@/lib/clock";
import { getSupabase } from "@/lib/supabase";
import { addUsage, totals, type Usage } from "./usage";

// What agents cost one restaurant this month and last month, split by agent
// (estimated from tokens and the API's published prices). Builder controls.

export type MonthCost = { month: string; jobs: number; byAgent: Record<string, number>; total: number };

// Pure: groups jobs by London month (YYYY-MM) and adds up each agent's cost.
export function monthlyCosts(jobs: { created_at: string; usage: Usage | null }[]): MonthCost[] {
  const months = new Map<string, { jobs: number; usage: Usage }>();
  for (const j of jobs) {
    if (!j.usage) continue;
    const month = londonYmd(new Date(j.created_at)).slice(0, 7);
    const m = months.get(month) ?? { jobs: 0, usage: {} };
    months.set(month, { jobs: m.jobs + 1, usage: addUsage(m.usage, j.usage) });
  }
  return [...months.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, m]) => ({
      month,
      jobs: m.jobs,
      byAgent: Object.fromEntries(Object.entries(m.usage).map(([agent, t]) => [agent, t.cost])),
      total: totals(m.usage).cost,
    }));
}

export async function costsFor(restaurantId: string, now = new Date()) {
  const startOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
  const { data, error } = await getSupabase()
    .from("agent_jobs")
    .select("created_at, usage")
    .eq("restaurant_id", restaurantId)
    .gte("created_at", startOfLastMonth)
    .returns<{ created_at: string; usage: Usage | null }[]>();
  // Before supabase/021_visibility.sql has been run there's no usage column yet.
  if (error) return [];
  return monthlyCosts(data ?? []).slice(0, 2);
}
