// The job queue (supabase/027_job_queue.sql, lib/queue): the real SQL runs in
// PGlite, the app's queue code runs on top of it, and Claude, WhatsApp and
// email are stand-ins.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { memoryDb } from "./support/memory-db";
import { newQueueDb, rpcOn } from "./support/queue-pg";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const T0 = new Date("2026-10-13T08:05:00Z"); // a Tuesday, 9:05 UK
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);

let pg: PGlite;
let mem: ReturnType<typeof memoryDb>;
const alerts: { key: string; message: string }[] = [];
const toOwner: { to: string; text: string }[] = [];

beforeAll(async () => {
  pg = await newQueueDb();
  await pg.exec(`insert into restaurants (id, name) values ('${A}', 'Ember'), ('${B}', 'Cardamom')`);
});
afterAll(async () => pg.close());

const restaurantRow = (id: string, name: string) => ({ id, name, active: true, owner_whatsapp: `whatsapp:+44${id.slice(0, 4)}`, whatsapp_from: "whatsapp:+14155238886", last_brief_on: null });

beforeEach(async () => {
  vi.resetModules();
  await pg.exec("truncate jobs");
  alerts.length = 0;
  toOwner.length = 0;
  mem = memoryDb({ restaurants: [restaurantRow(A, "Ember"), restaurantRow(B, "Cardamom")], audit_log: [], agent_jobs: [] });
  const client = { ...mem.client, rpc: rpcOn(pg) };
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => client }));
  vi.doMock("@/lib/builder-alerts", () => ({ alertBuilder: async (key: string, message: string) => (alerts.push({ key, message }), "ok") }));
  vi.doMock("@/lib/notify", async (orig) => ({ ...(await orig<object>()), messageOwner: async (c: { to: string }, text: string) => void toOwner.push({ to: c.to, text }) }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("@/lib/builder-alerts");
  vi.doUnmock("@/lib/notify");
});

const store = () => import("@/lib/queue/store");
const sql = async <T = Record<string, unknown>>(q: string) => (await pg.query<T>(q)).rows;

describe("claiming", () => {
  test("two workers never claim the same job", async () => {
    const { enqueue, claim } = await store();
    for (let i = 0; i < 30; i++) await enqueue({ type: "weather", restaurantId: i % 2 ? A : B, key: `w${i}` });
    await pg.exec("update job_types set max_running = 100 where type = 'weather'");
    // Two workers asking at the same moment, again and again, a few jobs at a time.
    const take = (worker: string) => claim({ worker, limit: 4 });
    const rounds = await Promise.all(Array.from({ length: 6 }, (_, i) => Promise.all([take(`w1-${i}`), take(`w2-${i}`)])));
    const ids = rounds.flat(2).map((j) => j.id);
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
    expect(await claim({ worker: "late" })).toEqual([]);
    await pg.exec("update job_types set max_running = 5 where type = 'weather'");
  });

  test("each type's limit and one-at-a-time keys are respected", async () => {
    const { enqueue, claim } = await store();
    for (let i = 0; i < 5; i++) await enqueue({ type: "feedback", restaurantId: A, key: `f${i}` }); // max_running 2
    // Two messages from the same restaurant are answered one after the other.
    await enqueue({ type: "owner_message", restaurantId: A, key: "m1", priority: 0, concurrencyKey: `whatsapp:${A}` });
    await enqueue({ type: "owner_message", restaurantId: A, key: "m2", priority: 0, concurrencyKey: `whatsapp:${A}` });
    await enqueue({ type: "owner_message", restaurantId: B, key: "m3", priority: 0, concurrencyKey: `whatsapp:${B}` });
    const got = await claim({ worker: "w", limit: 20 });
    expect(got.map((j) => j.idempotency_key).sort()).toEqual(["f0", "f1", "m1", "m3"]);
    // m2 waits until m1 is finished.
    const { complete } = await store();
    await complete(got.find((j) => j.idempotency_key === "m1")!.id, "w", null);
    expect((await claim({ worker: "w", limit: 20 })).map((j) => j.idempotency_key)).toEqual(["m2"]);
  });

  test("priority: owner replies, then morning jobs before 9:30, then the rest", async () => {
    const { priorityFor } = await import("@/lib/queue/rules");
    expect(priorityFor("owner_message", T0)).toBe(0);
    expect(priorityFor("morning", new Date("2026-10-13T08:29:00Z"))).toBe(10); // 9:29 UK
    expect(priorityFor("morning", new Date("2026-10-13T08:30:00Z"))).toBe(50); // 9:30 UK
    expect(priorityFor("morning", new Date("2026-12-01T09:29:00Z"))).toBe(10); // 9:29 GMT
    expect(priorityFor("review_check", T0)).toBe(50);
    // Within the morning a later step goes first, so restaurants finish one by one.
    expect(priorityFor("morning", T0, "release")).toBe(10);
    expect(priorityFor("morning", T0, "brief")).toBe(5);
    expect(priorityFor("morning", new Date("2026-10-13T09:00:00Z"), "brief")).toBe(45);

    const { enqueue, claim } = await store();
    const add = (type: string, key: string, at: Date) => enqueue({ type, restaurantId: A, key, priority: priorityFor(type, at), runAt: plus(-10) });
    await add("weather", "normal-oldest", T0);
    await add("morning", "morning-late", new Date("2026-10-13T08:40:00Z"));
    await add("morning", "morning-early", T0);
    await add("owner_message", "owner", T0);
    await add("review_check", "normal", T0);
    const order = [];
    for (let i = 0; i < 5; i++) order.push((await claim({ worker: `w${i}`, now: T0 }))[0].idempotency_key);
    expect(order).toEqual(["owner", "morning-early", "normal-oldest", "morning-late", "normal"]);
  });

  test("a job isn't run before its time", async () => {
    const { enqueue, claim } = await store();
    await enqueue({ type: "health_check", restaurantId: null, key: "h", runAt: plus(26) });
    expect(await claim({ worker: "w", now: T0 })).toEqual([]);
    expect(await claim({ worker: "w", now: plus(26) })).toHaveLength(1);
  });
});

describe("idempotency", () => {
  test("the same key queued twice is one job, run once", async () => {
    const { enqueue } = await store();
    expect(await enqueue({ type: "weather", restaurantId: A, key: "weather:A:2026-10-13T08" })).not.toBeNull();
    expect(await enqueue({ type: "weather", restaurantId: A, key: "weather:A:2026-10-13T08" })).toBeNull();
    const run = vi.fn(async () => ({ ok: true }));
    const { runWorker } = await import("@/lib/queue/worker");
    expect(await runWorker({ handlers: { weather: { run } } })).toHaveLength(1);
    expect(await runWorker({ handlers: { weather: { run } } })).toHaveLength(0);
    expect(run).toHaveBeenCalledTimes(1);
    // Even after it's done, the same key can't be queued again (until the clean-up removes it).
    expect(await enqueue({ type: "weather", restaurantId: A, key: "weather:A:2026-10-13T08" })).toBeNull();
  });
});

describe("retries and dead jobs", () => {
  test("a failure waits 1, 5, 15 then 60 minutes; after the last try the job is dead and the builder told once", async () => {
    const { enqueue } = await store();
    await enqueue({ type: "weather", restaurantId: A, key: "w", maxAttempts: 5, runAt: T0 });
    const { runWorker } = await import("@/lib/queue/worker");
    const handlers = { weather: { run: async () => Promise.reject(new Error("Open-Meteo down")) } };
    const runAt = async () => (await sql<{ run_at: Date }>("select run_at from jobs"))[0].run_at.toISOString();

    let at = T0;
    const waits: number[] = [];
    for (let i = 1; i <= 4; i++) {
      expect((await runWorker({ handlers, now: () => at }))[0].status).toBe("retry");
      const next = new Date(await runAt());
      waits.push((next.getTime() - at.getTime()) / 60_000);
      expect(await runWorker({ handlers, now: () => new Date(next.getTime() - 1000) })).toEqual([]); // not yet
      at = next;
    }
    expect(waits).toEqual([1, 5, 15, 60]);
    expect(alerts).toEqual([]);
    expect((await runWorker({ handlers, now: () => at }))[0].status).toBe("dead");
    expect(await sql("select status, attempts, last_error from jobs")).toEqual([{ status: "dead", attempts: 5, last_error: "Open-Meteo down" }]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toMatch(/^Ember: the weather job died after 5 tries: Open-Meteo down/);
    expect(alerts[0].message).toMatch(/The owner hasn't been told/);
    // Another worker noticing the same dead job doesn't alert again.
    const { jobDied } = await import("@/lib/queue/worker");
    const [dead] = await (await store()).deadJobs();
    await jobDied(dead, new Error("again"), handlers);
    expect(alerts).toHaveLength(1);
    expect(toOwner).toEqual([]);
  });

  test("a job whose worker crashed is put back (the builder hears it got stuck), and dies after its last try", async () => {
    const { enqueue, claim } = await store();
    await enqueue({ type: "weather", restaurantId: A, key: "w", maxAttempts: 2, runAt: T0 });
    const { runWorker } = await import("@/lib/queue/worker");
    const handlers = { weather: { run: async () => ({ ok: true }) } };
    expect(await claim({ worker: "crashes", now: T0 })).toHaveLength(1); // lock: 300 seconds
    expect(await runWorker({ handlers, now: () => plus(1) })).toEqual([]); // still locked
    // At 6 minutes the lock has run out: the next worker puts it back (and claims nothing more here).
    expect(await runWorker({ handlers, now: () => plus(6), limit: 0 })).toEqual([]);
    expect(await claim({ worker: "crashes-again", now: plus(6) })).toHaveLength(1);
    expect(alerts.map((a) => a.key)).toEqual(["job-stuck:weather"]);
    // The second crash was its last try: dead, and the builder is told.
    expect(await runWorker({ handlers, now: () => plus(12) })).toEqual([]);
    expect(await sql("select status, attempts from jobs")).toEqual([{ status: "dead", attempts: 2 }]);
    expect(alerts.map((a) => a.key)).toEqual(["job-stuck:weather", expect.stringMatching(/^job-dead:/)]);
  });

  test("a PermanentJobError skips the retries", async () => {
    const { enqueue } = await store();
    const { PermanentJobError } = await import("@/lib/queue/registry");
    await enqueue({ type: "weather", restaurantId: A, key: "w" });
    const { runWorker } = await import("@/lib/queue/worker");
    const out = await runWorker({ handlers: { weather: { run: async () => Promise.reject(new PermanentJobError("no postcode")) } } });
    expect(out[0]).toMatchObject({ status: "dead", error: "no postcode" });
  });

  test("the builder's Retry puts a dead job back, and it's in the audit log", async () => {
    const { enqueue } = await store();
    await enqueue({ type: "morning", restaurantId: A, key: "morning:A:2026-10-13:post", payload: { step: "post", day: "2026-10-13" }, maxAttempts: 1 });
    const { runWorker } = await import("@/lib/queue/worker");
    await runWorker({ handlers: { morning: { run: async () => Promise.reject(new Error("Claude down")) } } });
    const [dead] = await (await store()).deadJobs();
    const { retryDeadJob } = await import("@/lib/queue/retry");
    expect(await retryDeadJob(dead.id, "me@builder.test")).toBe(true);
    expect(await retryDeadJob(dead.id, "me@builder.test")).toBe(false); // not dead any more
    expect(await sql("select status, attempts, alerted_at from jobs")).toEqual([{ status: "queued", attempts: 0, alerted_at: null }]);
    expect(mem.tables.audit_log).toEqual([
      expect.objectContaining({ restaurant_id: A, actor: "builder", action: "job_retried", detail: "Retried the morning job (post) that had stopped (by me@builder.test)" }),
    ]);
  });

  test("the daily clean-up removes done jobs after 14 days and dead ones after 90", async () => {
    const { RETENTION } = await import("@/lib/queue/config");
    expect(RETENTION).toEqual({ doneDays: 14, deadDays: 90 });
    await pg.exec(`insert into jobs (type, restaurant_id, idempotency_key, status, finished_at, max_attempts) values
      ('weather', '${A}', 'done-15', 'done', now() - interval '15 days', 3),
      ('weather', '${A}', 'done-13', 'done', now() - interval '13 days', 3),
      ('weather', '${A}', 'dead-91', 'dead', now() - interval '91 days', 3),
      ('weather', '${A}', 'dead-89', 'dead', now() - interval '89 days', 3),
      ('weather', '${A}', 'queued-old', 'queued', null, 3)`);
    const { cleanup } = await store();
    expect(await cleanup()).toBe(2);
    expect((await sql<{ idempotency_key: string }>("select idempotency_key from jobs order by 1")).map((r) => r.idempotency_key)).toEqual(["dead-89", "done-13", "queued-old"]);
  });
});

describe("restaurants are independent", () => {
  test("one restaurant failing (or slow) doesn't stop or delay another's jobs", async () => {
    const { enqueue } = await store();
    for (const r of [A, B]) for (const t of ["weather", "feedback"]) await enqueue({ type: t, restaurantId: r, key: `${t}:${r}` });
    const ran: string[] = [];
    const run = async (job: { restaurant_id: string | null; type: string }) => {
      if (job.restaurant_id === A) throw new Error("A broke");
      ran.push(`${job.type}:B`);
      return {};
    };
    const { runWorker } = await import("@/lib/queue/worker");
    const out = await runWorker({ handlers: { weather: { run }, feedback: { run } } });
    expect(ran.sort()).toEqual(["feedback:B", "weather:B"]);
    expect(out.filter((r) => r.restaurantId === A).map((r) => r.status)).toEqual(["retry", "retry"]);
    expect(out.filter((r) => r.restaurantId === B).map((r) => r.status)).toEqual(["done", "done"]);
  });
});

describe("the morning job", () => {
  test("its steps, in the same order as before, depend on the day", async () => {
    const { morningStepsFor, nextMorningStep } = await import("@/lib/queue/rules");
    expect(morningStepsFor(1)).toEqual(["release", "birthday", "post", "report", "monday", "brief"]); // Monday
    expect(morningStepsFor(4)).toEqual(["release", "post", "brief"]); // Thursday
    expect(morningStepsFor(2)).toEqual(["release", "brief"]);
    expect(nextMorningStep("report", 1)).toBe("monday");
    expect(nextMorningStep("brief", 1)).toBeNull();
  });

  test("each step queues the next only once it has worked, so the brief always comes last", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T08:05:00Z")); // Monday, 9:05 UK
    const ran: string[] = [];
    let postFails = true;
    vi.doMock("@/lib/morning", async (orig) => ({
      ...(await orig<object>()),
      runMorningStep: async (_r: unknown, step: string, _now: Date, carry: { released?: string }) => {
        ran.push(step);
        if (step === "post" && postFails) throw new Error("Claude timed out");
        return { done: step, carry: step === "release" ? { released: "2 sends went out" } : carry };
      },
    }));
    const { enqueueMorningStep } = await import("@/lib/queue/dispatch");
    await enqueueMorningStep(A, "2026-10-12", "release", new Date());
    const { runWorker } = await import("@/lib/queue/worker");
    const out = await runWorker({ types: ["morning"], lanes: 3 });
    expect(ran).toEqual(["release", "birthday", "post"]); // in order, one at a time, stopped at post
    expect(out.at(-1)).toMatchObject({ status: "retry", error: "Claude timed out" });
    expect(alerts[0].message).toMatch(/^Ember: the morning job \(post\) failed \(try 1 of 5\)/); // the first failure is reported
    // A minute later the retry works, and the rest follow, the brief last.
    postFails = false;
    await runWorker({ types: ["morning"], now: () => new Date(Date.now() + 2 * 60_000) });
    expect(ran).toEqual(["release", "birthday", "post", "post", "report", "monday", "brief"]);
    // What the first step found reached the brief.
    const brief = (await sql<{ payload: { carry: unknown } }>("select payload from jobs where idempotency_key like '%:brief'"))[0];
    expect(brief.payload.carry).toEqual({ released: "2 sends went out" });
    vi.useRealTimers();
    vi.doUnmock("@/lib/morning");
  });

  test("a brief held for WhatsApp's 24-hour rule is ready, not late; one that hasn't been built is late", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T08:15:00Z")); // Tuesday 9:15 UK
    vi.doMock("@/lib/assistant", () => ({ loadRestaurantContext: async (id: string) => ({ restaurant: mem.tables.restaurants.find((r) => r.id === id) }) }));
    vi.doMock("@/lib/brief", () => ({
      canMessageFreely: async () => false, // the owner hasn't written in 24 hours
      markBriefWaiting: async (r: { id: string }, now: Date) => void Object.assign(mem.tables.restaurants.find((x) => x.id === r.id)!, { brief_waiting_since: now.toISOString() }),
      sendBrief: async () => ({ sent: true }),
    }));
    const { runMorningStep } = await import("@/lib/morning");
    const a = mem.tables.restaurants.find((r) => r.id === A)!;
    const out = await runMorningStep(a as never, "brief", new Date());
    expect(out.brief).toBe("waiting for the owner to message (24h rule)");
    expect(a).toMatchObject({ last_brief_on: "2026-10-13", brief_waiting_since: expect.any(String) });
    // 9:31: A's brief is held (ready); B's was never built (its morning job died).
    const { checkLateBriefs } = await import("@/lib/queue/health");
    expect(await checkLateBriefs(new Date("2026-10-13T08:20:00Z"))).toEqual([]); // 9:20: not due yet
    expect(await checkLateBriefs(new Date("2026-10-13T08:31:00Z"))).toEqual([B]);
    expect(alerts.map((x) => x.message)).toEqual(["Cardamom's morning brief hasn't gone out (it was due by 9:30). See the morning jobs on /log. The owner hasn't been told."]);
    vi.useRealTimers();
    vi.doUnmock("@/lib/assistant");
    vi.doUnmock("@/lib/brief");
  });
});

describe("WhatsApp messages on the queue", () => {
  const payload = (kind: "owner" | "staff" = "owner") => ({ kind, owner: "whatsapp:+447700900123", sandbox: "whatsapp:+14155238886", body: "Thursday is quiet" });
  const queueMessage = async () => {
    const { enqueue } = await store();
    await enqueue({ type: "owner_message", restaurantId: A, key: "owner_message:SM1", priority: 0, concurrencyKey: `whatsapp:${A}`, payload: payload() });
  };
  const withBot = (handleMessage: () => Promise<void>) => {
    vi.doMock("@/lib/bot", () => ({ handleMessage }));
    vi.doMock("@/lib/onboarding/whatsapp-flow", () => ({ onboardingInProgress: async () => false, handleOnboardingMessage: async () => {} }));
  };
  afterEach(() => {
    vi.doUnmock("@/lib/bot");
    vi.doUnmock("@/lib/onboarding/whatsapp-flow");
  });

  test("a message is answered once, by one worker", async () => {
    const handleMessage = vi.fn(async () => {});
    withBot(handleMessage);
    await queueMessage();
    const { runWorker } = await import("@/lib/queue/worker");
    const [w1, w2] = await Promise.all([runWorker(), runWorker()]);
    expect([...w1, ...w2].map((r) => r.status)).toEqual(["done"]);
    expect(handleMessage).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: A, body: "Thursday is quiet" }));
    expect(handleMessage).toHaveBeenCalledTimes(1);
  });

  test("if handling it fails, the owner gets the usual Sorry once (never a retry) and the builder is alerted", async () => {
    const { SORRY, OwnerToldError } = await import("@/lib/sorry");
    // As in bot/index.ts: the handler sends Sorry itself, then reports the failure.
    withBot(async () => {
      toOwner.push({ to: "whatsapp:+447700900123", text: SORRY });
      throw new OwnerToldError(new Error("Claude overloaded"));
    });
    await queueMessage();
    const { runWorker } = await import("@/lib/queue/worker");
    expect((await runWorker())[0]).toMatchObject({ status: "dead", error: "Claude overloaded" });
    expect(await runWorker()).toEqual([]); // no second try
    expect(toOwner).toEqual([{ to: "whatsapp:+447700900123", text: SORRY }]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toMatch(/^Ember: the owner message job died after 1 try: Claude overloaded/);
  });

  test("if it fails before the handler could say Sorry, or the worker crashes, the queue sends it, once", async () => {
    const { SORRY } = await import("@/lib/sorry");
    withBot(async () => {
      throw new Error("database unreachable");
    });
    await queueMessage();
    const { runWorker } = await import("@/lib/queue/worker");
    await runWorker();
    expect(toOwner).toEqual([{ to: "whatsapp:+447700900123", text: SORRY }]);
    expect(alerts).toHaveLength(1);

    // A worker that crashed mid-message (its lock runs out): Sorry once, builder told once.
    toOwner.length = 0;
    alerts.length = 0;
    const { enqueue, claim } = await store();
    await enqueue({ type: "owner_message", restaurantId: A, key: "owner_message:SM2", priority: 0, payload: payload() });
    await claim({ worker: "crashes" });
    const later = () => new Date(Date.now() + 10 * 60_000);
    await runWorker({ now: later });
    await runWorker({ now: later });
    const { checkQueueHealth } = await import("@/lib/queue/health");
    await checkQueueHealth(later());
    expect(toOwner).toEqual([{ to: "whatsapp:+447700900123", text: SORRY }]);
    expect(alerts.filter((a) => a.key.startsWith("job-dead:"))).toHaveLength(1);
  });
});

describe("external workers (the Python service)", () => {
  beforeAll(async () => {
    await pg.exec("insert into job_types (type, runner, max_running, max_attempts) values ('forecast', 'external', 2, 3) on conflict do nothing");
  });
  const asWorker = async <T>(fn: () => Promise<T>) => {
    await pg.exec("set role queue_worker");
    try {
      return await fn();
    } finally {
      await pg.exec("reset role");
    }
  };

  test("claim, complete and fail their own job types through the ext_ functions", async () => {
    await asWorker(async () => {
      const q = <T>(s: string) => pg.query<T>(s).then((r) => r.rows);
      await q(`select * from ext_enqueue_job('forecast', '${A}', 'forecast:A:2026-10-13', '{"days": 7}')`);
      await q(`select * from ext_enqueue_job('forecast', '${B}', 'forecast:B:2026-10-13')`);
      const claimed = await q<{ id: string; restaurant_id: string; payload: unknown }>(`select * from ext_claim_jobs('py-1', array['forecast'], 5)`);
      expect(claimed.map((j) => j.restaurant_id).sort()).toEqual([A, B]);
      expect(await q(`select ext_complete_job('${claimed[0].id}', 'py-1', '{"rows": 7}') as ok`)).toEqual([{ ok: true }]);
      expect(await q(`select ext_complete_job('${claimed[1].id}', 'someone-else') as ok`)).toEqual([{ ok: false }]); // not its job
      const [failed] = await q<{ status: string; attempts: number }>(`select * from ext_fail_job('${claimed[1].id}', 'py-1', 'model diverged')`);
      expect(failed).toMatchObject({ status: "queued", attempts: 1 });
    });
    expect(await sql("select idempotency_key, status from jobs order by 1")).toEqual([
      { idempotency_key: "forecast:A:2026-10-13", status: "done" },
      { idempotency_key: "forecast:B:2026-10-13", status: "queued" },
    ]);
  });

  test("they can't touch the app's jobs or read any table, and the app's workers leave theirs alone", async () => {
    const { enqueue, claim } = await store();
    const appJob = await enqueue({ type: "weather", restaurantId: A, key: "app-weather" });
    await enqueue({ type: "forecast", restaurantId: A, key: "py-forecast" });
    await asWorker(async () => {
      await expect(pg.query(`select * from ext_claim_jobs('py', array['weather'])`)).rejects.toThrow(/Only external job types/);
      await expect(pg.query(`select * from ext_enqueue_job('owner_message', '${A}', 'x')`)).rejects.toThrow(/not an external job type/);
      await expect(pg.query(`select * from claim_jobs('py')`)).rejects.toThrow(/permission denied/);
      await expect(pg.query(`select * from jobs`)).rejects.toThrow(/permission denied/);
      await expect(pg.query(`update jobs set status = 'done'`)).rejects.toThrow(/permission denied/);
      expect((await pg.query(`select ext_complete_job('${appJob!.id}', 'py') as ok`)).rows).toEqual([{ ok: false }]);
    });
    // The app's worker only claims app jobs.
    expect((await claim({ worker: "app", limit: 10 })).map((j) => j.idempotency_key)).toEqual(["app-weather"]);
  });

  test("a dead external job is reported to the builder by the health check", async () => {
    await asWorker(async () => {
      await pg.query(`select * from ext_enqueue_job('forecast', '${A}', 'f-dies')`);
      for (let i = 0; i < 3; i++) {
        const [j] = (await pg.query<{ id: string }>(`select * from ext_claim_jobs('py', array['forecast'])`)).rows;
        await pg.query(`select * from ext_fail_job('${j.id}', 'py', 'out of memory', true)`);
        await pg.exec("reset role");
        await pg.exec("update jobs set run_at = now() where status = 'queued'"); // skip the backoff wait
        await pg.exec("set role queue_worker");
      }
    });
    expect(await sql("select status from jobs")).toEqual([{ status: "dead" }]);
    const { checkQueueHealth } = await import("@/lib/queue/health");
    await checkQueueHealth(new Date());
    expect(alerts.map((a) => a.message)).toEqual([expect.stringMatching(/^Ember: the forecast job died after 3 tries: out of memory/)]);
    await checkQueueHealth(new Date());
    expect(alerts).toHaveLength(1);
  });
});

describe("workers wanted (the every-minute schedule)", () => {
  test("none when nothing is due; one per 3 due jobs, up to 10; one if a lock has run out", async () => {
    const { enqueue, claim, workersWanted } = await store();
    expect(await workersWanted()).toBe(0);
    for (let i = 0; i < 7; i++) await enqueue({ type: "weather", restaurantId: A, key: `w${i}` });
    await enqueue({ type: "forecast", restaurantId: A, key: "external" }).catch(() => null); // external jobs don't count
    expect(await workersWanted()).toBe(3);
    await pg.exec("update job_types set max_running = 100 where type = 'weather'");
    for (let i = 7; i < 60; i++) await enqueue({ type: "weather", restaurantId: A, key: `w${i}` });
    expect(await workersWanted()).toBe(10);
    await claim({ worker: "w", limit: 60 });
    expect(await workersWanted()).toBe(0);
    expect(await workersWanted(new Date(Date.now() + 10 * 60_000))).toBe(1); // their locks have run out
    await pg.exec("update job_types set max_running = 5 where type = 'weather'");
  });
});
