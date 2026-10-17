import "server-only";
import { db, must } from "./db";
import { isShowableRun } from "./model-roles";
import type { DealOutcomeRow, FinanceSnapshotRow, ForecastMetric, ForecastRow, ModelKind, ModelRole, ModelRunRow, OpsSource, SalesChannelSplitRow, Channel } from "./types";

// Model runs and outputs (035_ops_models.sql), deal outcomes (033) and the extra
// sales detail (032). Outputs are never overwritten: a new run adds rows and the
// latest issued_at wins. The Python service writes these through its own login
// (model_writer); the app uses these helpers to read them, and to record
// what it expected when the owner approved a deal.
//
// This file is the only place the app reads model outputs. A row made by a model
// run is only returned if that run is a production run that succeeded and
// passed (isShowableRun): a benchmark run never is, whatever "passed" says.
// tests/analytics-jobs.test.ts fails if another file reads an output table.

export async function startModelRun(
  restaurantId: string,
  input: { modelName: string; modelVersion: string; kind: ModelKind; role: ModelRole; dataFrom?: string | null; dataTo?: string | null; dataCutoff?: string | null; params?: unknown; jobId?: string | null },
) {
  return must(
    await db()
      .from("model_runs")
      .insert({
        restaurant_id: restaurantId,
        model_name: input.modelName,
        model_version: input.modelVersion,
        kind: input.kind,
        role: input.role,
        data_from: input.dataFrom ?? null,
        data_to: input.dataTo ?? null,
        data_cutoff: input.dataCutoff ?? null,
        params: input.params ?? null,
        job_id: input.jobId ?? null,
      })
      .select("*")
      .single(),
    "start model run",
  ) as ModelRunRow;
}

// The same function the Python service calls: only a running run can finish.
export async function finishModelRun(runId: string, status: "succeeded" | "failed", result: { metrics?: unknown; backtestScore?: number | null; passed?: boolean | null } = {}) {
  return must(
    await db().rpc("finish_model_run", {
      p_run_id: runId,
      p_status: status,
      p_metrics: result.metrics ?? null,
      p_backtest_score: result.backtestScore ?? null,
      p_passed: result.passed ?? null,
    }),
    "finish model run",
  ) as boolean;
}

// The runs among these ids that may be shown (production, succeeded, passed).
async function showableRunIds(restaurantId: string, runIds: (string | null)[]) {
  const ids = [...new Set(runIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Set<string>();
  const runs = must(
    await db().from("model_runs").select("id, role, status, passed").eq("restaurant_id", restaurantId).in("id", ids),
    "model runs",
  ) as Pick<ModelRunRow, "id" | "role" | "status" | "passed">[];
  return new Set(runs.filter(isShowableRun).map((r) => r.id));
}

// Rows from a model run only if the run may be shown; rows no model made (e.g.
// the uplift the app expected when a deal was approved) are kept.
async function withoutUnshowableRuns<T extends { model_run_id: string | null }>(restaurantId: string, rows: T[]) {
  const ok = await showableRunIds(restaurantId, rows.map((r) => r.model_run_id));
  return rows.filter((r) => r.model_run_id === null || ok.has(r.model_run_id));
}

// The latest forecast for each day (and hour) in a span, from production runs that passed.
export async function latestForecasts(restaurantId: string, fromDay: string, toDay: string, metric: ForecastMetric, channel: "all" | Channel = "all") {
  const passed = (
    must(
      await db()
        .from("model_runs")
        .select("id, role, status, passed")
        .eq("restaurant_id", restaurantId)
        .eq("kind", "forecast")
        .eq("role", "production")
        .eq("status", "succeeded")
        .eq("passed", true),
      "passed runs",
    ) as Pick<ModelRunRow, "id" | "role" | "status" | "passed">[]
  ).filter(isShowableRun);
  if (!passed.length) return [];
  const rows = must(
    await db()
      .from("forecasts")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("metric", metric)
      .eq("channel", channel)
      .gte("target_day", fromDay)
      .lte("target_day", toDay)
      .in("model_run_id", passed.map((p) => p.id)),
    "forecasts",
  ) as ForecastRow[];
  return latestPerTarget(rows);
}

// One row per target (day, or day and hour): the latest issued.
export function latestPerTarget<T extends { target_day: string; hour_start: string | null; issued_at: string }>(rows: T[]) {
  const best = new Map<string, T>();
  for (const r of rows) {
    const key = `${r.target_day}|${r.hour_start ?? ""}`;
    const cur = best.get(key);
    if (!cur || r.issued_at > cur.issued_at) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => (a.target_day + (a.hour_start ?? "")).localeCompare(b.target_day + (b.hour_start ?? "")));
}

export async function latestFinanceSnapshot(restaurantId: string, weekStart: string) {
  const rows = must(
    await db().from("finance_snapshots").select("*").eq("restaurant_id", restaurantId).eq("week_start", weekStart).order("issued_at", { ascending: false }),
    "finance snapshot",
  ) as FinanceSnapshotRow[];
  return (await withoutUnshowableRuns(restaurantId, rows))[0] ?? null;
}

// What we expected when the owner approved a deal (measured outcomes come from the models).
export async function recordExpectedUplift(
  restaurantId: string,
  input: { campaignId: string; upliftPence?: number | null; upliftPct?: number | null; extraCovers?: number | null; windowStart?: string | null; windowEnd?: string | null; method: string; notes?: string | null },
) {
  return must(
    await db()
      .from("deal_outcomes")
      .insert({
        restaurant_id: restaurantId,
        campaign_id: input.campaignId,
        kind: "expected",
        uplift_pence: input.upliftPence ?? null,
        uplift_pct: input.upliftPct ?? null,
        extra_covers: input.extraCovers ?? null,
        window_start: input.windowStart ?? null,
        window_end: input.windowEnd ?? null,
        method: input.method,
        notes: input.notes ?? null,
        source: "assumed",
      })
      .select("*")
      .single(),
    "record expected uplift",
  ) as DealOutcomeRow;
}

export async function dealOutcomes(restaurantId: string, campaignId: string) {
  const rows = must(
    await db().from("deal_outcomes").select("*").eq("restaurant_id", restaurantId).eq("campaign_id", campaignId).order("recorded_at"),
    "deal outcomes",
  ) as DealOutcomeRow[];
  return withoutUnshowableRuns(restaurantId, rows);
}

// ---------- Sales detail: covers and channels ----------

export async function setCovers(restaurantId: string, day: string, covers: number, source: OpsSource, hour?: number) {
  const table = hour === undefined ? "sales_days" : "sales_hours";
  let q = db().from(table).update({ covers, covers_source: source }).eq("restaurant_id", restaurantId).eq("day", day);
  if (hour !== undefined) q = q.eq("hour", hour);
  must(await q, "set covers");
}

export async function saveChannelSplit(
  restaurantId: string,
  rows: { day: string; hour?: number | null; channel: Channel; salesPence: number; includesVat?: boolean; orders?: number | null; covers?: number | null; source: OpsSource }[],
) {
  if (!rows.length) return [];
  return must(
    await db()
      .from("sales_channel_splits")
      .insert(
        rows.map((r) => ({
          restaurant_id: restaurantId,
          day: r.day,
          hour: r.hour ?? null,
          channel: r.channel,
          sales_pence: r.salesPence,
          includes_vat: r.includesVat ?? true,
          orders: r.orders ?? null,
          covers: r.covers ?? null,
          source: r.source,
        })),
      )
      .select("*"),
    "save channel split",
  ) as SalesChannelSplitRow[];
}
