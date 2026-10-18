// The analytics service's side of the app (supabase/039_analytics_jobs.sql):
// the nightly model jobs the dispatcher queues, the job type and the service's
// extra queue functions, and benchmark runs never reaching an owner (the gate
// in lib/ops/models.ts, and the database hiding them from owner logins).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, test } from "vitest";
import { londonTime } from "@/lib/clock";
import { isShowableRun, MODEL_OUTPUT_TABLES } from "@/lib/ops/model-roles";
import { NIGHTLY_MODELS, type NightlyModel } from "@/lib/queue/config";
import { plannedJobs } from "@/lib/queue/rules";
import { newFullDb, readMigration } from "./support/full-pg";

const R = { id: "abababab-0000-0000-0000-000000000001", hasOwnerChannel: true };

describe("the nightly model jobs", () => {
  const types = NIGHTLY_MODELS.map((m) => m.type);
  const modelJobs = (job: "hourly" | "daily", now: Date, models: readonly NightlyModel[] = NIGHTLY_MODELS) =>
    plannedJobs(R, job, now, "not yet", models).filter((p) => types.includes(p.type));
  const job = (type: string, runAt: Date) => ({
    type,
    key: `${type}:${R.id}:2026-10-18`,
    priority: 50,
    concurrencyKey: `models:${R.id}`,
    payload: { day: "2026-10-18" },
    runAt,
  });

  test("the 05:05 UK hourly run queues the re-fits to start at 05:35, one per model, keyed by the UK day", () => {
    const at535 = londonTime(2026, 10, 18, 5, 35);
    expect(modelJobs("hourly", londonTime(2026, 10, 18, 5, 5))).toEqual([job("forecast_baseline", at535), job("forecast_daily", at535)]);
    // Other hours queue nothing, in summer and in winter time (when UK and UTC agree).
    expect(modelJobs("hourly", londonTime(2026, 10, 18, 3, 5))).toEqual([]);
    expect(modelJobs("hourly", londonTime(2026, 10, 18, 4, 5))).toEqual([]);
    expect(modelJobs("hourly", londonTime(2026, 10, 18, 6, 5))).toEqual([]);
    const winter = modelJobs("hourly", londonTime(2026, 12, 1, 5, 5));
    expect(winter.map((p) => p.runAt?.toISOString())).toEqual(["2026-12-01T05:35:00.000Z", "2026-12-01T05:35:00.000Z"]);
    expect(modelJobs("hourly", londonTime(2026, 7, 1, 5, 5)).map((p) => p.runAt?.toISOString())).toEqual(["2026-07-01T04:35:00.000Z", "2026-07-01T04:35:00.000Z"]);
  });

  test("the 07:05 hourly run queues the weather refresh to start at 07:00, so it starts at once", () => {
    // 07:00 has passed by 07:05, so it has no runAt (it starts at once).
    const refresh: Partial<ReturnType<typeof job>> = job("forecast_refresh", londonTime(2026, 10, 18, 7, 0));
    delete refresh.runAt;
    expect(modelJobs("hourly", londonTime(2026, 10, 18, 7, 5))).toEqual([refresh]);
    // Each model has its own time.
    expect(NIGHTLY_MODELS).toEqual([
      { type: "forecast_baseline", at: { hour: 5, minute: 35 } },
      { type: "forecast_daily", at: { hour: 5, minute: 35 } },
      { type: "forecast_refresh", at: { hour: 7, minute: 0 } },
    ]);
  });

  test("a model due later in its hour is queued to start then", () => {
    const later: NightlyModel[] = [{ type: "forecast_refresh", at: { hour: 7, minute: 40 } }];
    expect(modelJobs("hourly", londonTime(2026, 10, 18, 7, 5), later)).toEqual([job("forecast_refresh", londonTime(2026, 10, 18, 7, 40))]);
  });

  test("on the clock-change nights 05:35 still means 05:35 UK", () => {
    expect(modelJobs("hourly", londonTime(2026, 3, 29, 5, 5)).map((p) => p.runAt?.toISOString())[0]).toBe("2026-03-29T04:35:00.000Z");
    expect(modelJobs("hourly", londonTime(2026, 10, 25, 5, 5)).map((p) => p.runAt?.toISOString())[0]).toBe("2026-10-25T05:35:00.000Z");
  });

  test("a late hourly run, or the daily backup, starts them at once", () => {
    expect(modelJobs("hourly", londonTime(2026, 10, 18, 5, 50))[0].runAt).toBeUndefined();
    expect(modelJobs("daily", londonTime(2026, 10, 18, 10, 0)).every((p) => p.runAt === undefined)).toBe(true);
  });

  test("the daily backup queues the same jobs (same keys), so missed runs are caught up and never doubled", () => {
    const night = [...modelJobs("hourly", londonTime(2026, 10, 18, 5, 5)), ...modelJobs("hourly", londonTime(2026, 10, 18, 7, 5))];
    const backup = modelJobs("daily", londonTime(2026, 10, 18, 10, 0));
    expect(backup.map((p) => p.key)).toEqual(night.map((p) => p.key));
  });

  test("nothing is queued while ANALYTICS_JOBS is off (no models passed)", () => {
    expect(modelJobs("hourly", londonTime(2026, 10, 18, 5, 5), [])).toEqual([]);
    expect(modelJobs("daily", londonTime(2026, 10, 18, 10, 0), [])).toEqual([]);
  });

  test("they come after the restaurant's other jobs", () => {
    const all = plannedJobs(R, "hourly", londonTime(2026, 10, 18, 5, 5), null, NIGHTLY_MODELS);
    expect(all.slice(-2).map((p) => p.type)).toEqual(["forecast_baseline", "forecast_daily"]);
  });
});

describe("benchmark runs are never shown", () => {
  test("only a production run that succeeded and passed may be shown", () => {
    expect(isShowableRun({ role: "production", status: "succeeded", passed: true })).toBe(true);
    expect(isShowableRun({ role: "benchmark", status: "succeeded", passed: true })).toBe(false);
    expect(isShowableRun({ role: "production", status: "succeeded", passed: false })).toBe(false);
    expect(isShowableRun({ role: "production", status: "succeeded", passed: null })).toBe(false);
    expect(isShowableRun({ role: "production", status: "failed", passed: true })).toBe(false);
    expect(isShowableRun({ role: null, status: "succeeded", passed: true })).toBe(false);
    expect(isShowableRun({ status: "succeeded", passed: true })).toBe(false);
    expect(isShowableRun(null)).toBe(false);
  });

  test("lib/ops/models.ts is the only file in the app that reads model outputs or runs", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk("src");
    const tables = [...MODEL_OUTPUT_TABLES, "model_runs"];
    const pattern = new RegExp(`\\.from\\(\\s*["'\`](${tables.join("|")})["'\`]`);
    const readers = files.filter((f) => pattern.test(readFileSync(f, "utf8"))).map((f) => f.replaceAll("\\", "/"));
    expect(readers).toEqual(["src/lib/ops/models.ts"]);
  });
});

describe("the database (039 on a fresh database)", () => {
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";
  let pg: PGlite;
  const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
  const as = async <T>(role: string, email: string | null, fn: () => Promise<T>) => {
    await pg.exec(`set role ${role}`);
    await pg.query("select set_config('request.jwt.claims', $1, false)", [email ? JSON.stringify({ email }) : ""]);
    try {
      return await fn();
    } finally {
      await pg.exec("reset role");
      await pg.query("select set_config('request.jwt.claims', '', false)");
    }
  };

  beforeAll(async () => {
    pg = await newFullDb();
    await pg.query("update restaurants set owner_email = 'owner@ember.test' where id = $1", [A]);
  }, 120_000);

  test("forecast_baseline is an external job type, and the file runs again safely", async () => {
    expect(await all("select runner, max_running, max_attempts, lock_seconds from job_types where type = 'forecast_baseline'")).toEqual([
      { runner: "external", max_running: 4, max_attempts: 3, lock_seconds: 300 },
    ]);
    await pg.exec(readMigration("039_analytics_jobs.sql"));
    expect(await all("select count(*)::int as n from schema_migrations where name = '039_analytics_jobs.sql'")).toEqual([{ n: 1 }]);
  });

  test("a model run must say its role", async () => {
    await expect(pg.query("insert into model_runs (restaurant_id, model_name, model_version, kind) values ($1, 'x', '1', 'forecast')", [A])).rejects.toThrow(
      /null value in column "role"/,
    );
    await expect(
      pg.query("insert into model_runs (restaurant_id, model_name, model_version, kind, role) values ($1, 'x', '1', 'forecast', 'shown')", [A]),
    ).rejects.toThrow(/model_runs_role_check/);
  });

  test("an owner's login never sees a benchmark run or its outputs, even if it passed", async () => {
    const bench = "aaaaaaaa-0000-0000-0000-00000000000b";
    const prod = "aaaaaaaa-0000-0000-0000-00000000000c";
    await as("model_writer", null, async () => {
      for (const [id, role] of [
        [bench, "benchmark"],
        [prod, "production"],
      ]) {
        await pg.query(
          "insert into model_runs (id, restaurant_id, model_name, model_version, kind, role) values ($1, $2, $3, '1', 'forecast', $4)",
          [id, A, `m_${role}`, role],
        );
        await pg.query(
          "insert into forecasts (restaurant_id, model_run_id, target_day, metric, low, likely, high) values ($1, $2, '2026-10-20', 'orders', 1, 2, 3)",
          [A, id],
        );
        await pg.query("select finish_model_run($1, 'succeeded', null, 0.1, true)", [id]);
      }
    });
    const seen = await as("authenticated", "owner@ember.test", async () => ({
      runs: (await all<{ role: string }>("select role from model_runs")).map((r) => r.role),
      forecasts: (await all<{ model_run_id: string }>("select model_run_id from forecasts")).map((r) => r.model_run_id),
    }));
    expect(seen).toEqual({ runs: ["production"], forecasts: [prod] });
    // The service still reads both through its analytics view (benchmarks are compared there).
    const viaView = await as("analytics_reader", null, () => all<{ role: string }>("select role from analytics.model_runs order by role"));
    expect(viaView.map((r) => r.role)).toEqual(["benchmark", "production"]);
  });

  test("040: the forecast's job types, and the file runs again safely", async () => {
    expect(
      await all("select type, runner, max_running, max_attempts, lock_seconds from job_types where type in ('forecast_daily', 'forecast_refresh') order by type"),
    ).toEqual([
      { type: "forecast_daily", runner: "external", max_running: 4, max_attempts: 3, lock_seconds: 300 },
      { type: "forecast_refresh", runner: "external", max_running: 4, max_attempts: 3, lock_seconds: 180 },
    ]);
    await pg.exec(readMigration("040_forecast_model.sql"));
    expect(await all("select count(*)::int as n from schema_migrations where name = '040_forecast_model.sql'")).toEqual([{ n: 1 }]);
  });

  test("040: an owner sees weights and drivers only of a production run that succeeded and passed", async () => {
    const runs = [
      ["aaaaaaaa-0000-0000-0000-0000000000d1", "production", true],
      ["aaaaaaaa-0000-0000-0000-0000000000d2", "production", false],
      ["aaaaaaaa-0000-0000-0000-0000000000d3", "benchmark", true],
    ] as const;
    const addRows = async (id: string) => {
      await pg.query("insert into model_coefficients (restaurant_id, model_run_id, channel, factor, estimate) values ($1, $2, 'all', 'weekday_sat', 0.2)", [A, id]);
      await pg.query(
        "insert into forecast_drivers (restaurant_id, model_run_id, target_day, channel, factor, multiplier) values ($1, $2, '2026-10-20', 'all', 'weekday', 1.2)",
        [A, id],
      );
    };
    const newRun = (id: string, role: string) =>
      pg.query("insert into model_runs (id, restaurant_id, model_name, model_version, kind, role) values ($1, $2, 'forecast_daily', '1', 'forecast', $3)", [id, A, role]);
    await as("model_writer", null, async () => {
      for (const [id, role, passed] of runs) {
        await newRun(id, role);
        await addRows(id);
        await pg.query("select finish_model_run($1, 'succeeded', null, 0.1, $2)", [id, passed]);
      }
      // A run still going isn't shown either.
      await newRun("aaaaaaaa-0000-0000-0000-0000000000d4", "production");
      await addRows("aaaaaaaa-0000-0000-0000-0000000000d4");
    });
    const seen = await as("authenticated", "owner@ember.test", async () => ({
      coefficients: (await all<{ model_run_id: string }>("select model_run_id from model_coefficients")).map((r) => r.model_run_id),
      drivers: (await all<{ model_run_id: string }>("select model_run_id from forecast_drivers")).map((r) => r.model_run_id),
    }));
    expect(seen).toEqual({ coefficients: [runs[0][0]], drivers: [runs[0][0]] });
    // The writer may only add rows; an owner may not add any.
    await expect(as("model_writer", null, () => all("select * from model_coefficients"))).rejects.toThrow(/permission denied/);
    await expect(as("model_writer", null, () => all("delete from forecast_drivers"))).rejects.toThrow(/permission denied/);
    await expect(
      as("authenticated", "owner@ember.test", () =>
        all("insert into forecast_drivers (restaurant_id, model_run_id, target_day, channel, factor, multiplier) values ($1, $2, '2026-10-21', 'all', 'x', 1)", [
          A,
          runs[0][0],
        ]),
      ),
    ).rejects.toThrow(/row-level security|permission denied/);
  });

  test("040: an uncertain date takes its alternative day from the notes, then and later", async () => {
    await pg.query(
      "insert into local_calendar (restaurant_id, day, name, type, date_uncertain, notes) values ($1, '2027-03-10', 'Eid al-Fitr', 'religious', true, 'Alternative dates: 2027-03-11 (UK moon sighting)')",
      [A],
    );
    expect(await all("select alt_day::text as alt_day from local_calendar where restaurant_id = $1 and day = '2027-03-10'", [A])).toEqual([{ alt_day: "2027-03-11" }]);
    const viaView = await as("analytics_reader", null, () => all("select alt_day::text as alt_day from analytics.calendar where first_day = '2027-03-10'"));
    expect(viaView).toEqual([{ alt_day: "2027-03-11" }]);
  });

  test("the service gives a job back on shutdown without using up a try, and can look at its own jobs only", async () => {
    const q = <T = Record<string, unknown>>(sql: string) => as("queue_worker", null, () => all<T>(sql));
    await q(`select * from ext_enqueue_job('forecast_baseline', '${A}', 'fb:A')`);
    await q(`select * from ext_enqueue_job('forecast_baseline', '${B}', 'fb:B')`);
    // The four-argument claim takes only that restaurant's job.
    const [claimed] = await q<{ id: string; restaurant_id: string; attempts: number }>(`select * from ext_claim_jobs('py', array['forecast_baseline'], 5, '${B}')`);
    expect(claimed).toMatchObject({ restaurant_id: B, attempts: 1 });
    expect(await q(`select ext_release_job('${claimed.id}', 'someone-else') as ok`)).toEqual([{ ok: false }]);
    expect(await q(`select ext_release_job('${claimed.id}', 'py') as ok`)).toEqual([{ ok: true }]);
    expect(await q(`select status, attempts from ext_job_status('${claimed.id}')`)).toEqual([{ status: "queued", attempts: 0 }]);
    // An app job is invisible to it.
    const [appJob] = await all<{ id: string }>(`select * from enqueue_job('weather', '${A}', 'app-weather')`);
    expect(await q(`select * from ext_job_status('${appJob.id}')`)).toEqual([]);
    expect(await q(`select ext_release_job('${appJob.id}', 'py') as ok`)).toEqual([{ ok: false }]);
    await expect(as("queue_worker", null, () => all(`select * from ext_claim_jobs('py', array['weather'], 1, '${A}')`))).rejects.toThrow(/Only external/);
    // Nobody else may call them.
    await expect(as("authenticated", "owner@ember.test", () => all(`select * from ext_job_status('${claimed.id}')`))).rejects.toThrow(/permission denied/);
  });
});
