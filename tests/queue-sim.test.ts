// A simulated Monday morning for 50 restaurants (the heaviest day: birthday
// email, Google post, weekly report and the Monday agents before each brief).
// The queue is real (supabase/027_job_queue.sql in PGlite: claiming, limits,
// priorities, retries); the clock is simulated, and Claude and email are
// stand-ins that take a realistic time. Workers start as in production: the
// hourly job starts workers_wanted() at 9:05, Supabase starts workers_wanted()
// every minute, and each owner message starts one. Each worker runs 3 jobs
// side by side and stops taking new ones after 150 seconds.
// Every brief must go by 9:15. The timings are printed.
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newQueueDb, rpcOn } from "./support/queue-pg";

const START = new Date("2026-10-12T08:05:00Z"); // Monday, 9:05 UK (the hourly job)
const BRIEF_BY = new Date("2026-10-12T08:15:00Z"); // 9:15 UK
const END = new Date("2026-10-12T09:00:00Z"); // stop the simulation at 10:00 UK
const RESTAURANTS = 50;
const ids = Array.from({ length: RESTAURANTS }, (_, i) => `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`);

let pg: PGlite;
beforeAll(async () => {
  pg = await newQueueDb();
  await pg.exec(`insert into restaurants (id, name) values ${ids.map((id, i) => `('${id}', 'R${i + 1}')`).join(", ")}`);
});
afterAll(async () => pg.close());
beforeEach(async () => {
  vi.resetModules();
  await pg.exec("truncate jobs");
  const client = { rpc: rpcOn(pg), from: () => ({}) };
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => client }));
});

// A small seeded random number generator, so every run is the same.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

// How long each job takes (seconds), and what it queues when it's done.
// Claude calls 10 to 60 seconds; email sends and look-ups about a second.
type Effect = { agentJobs?: number };
function workFor(type: string, step: string | undefined, rand: () => number): { seconds: number } & Effect {
  const between = (a: number, b: number) => a + (b - a) * rand();
  switch (type) {
    case "owner_message":
      return { seconds: between(5, 20) };
    case "review_check":
      return { seconds: rand() < 0.3 ? between(10, 20) : between(1, 2) }; // 3 in 10 find a review to draft
    case "agent":
      return { seconds: between(15, 40) };
    case "morning":
      switch (step) {
        case "release":
          return { seconds: between(1, 3) };
        case "birthday":
          return { seconds: between(12, 25), agentJobs: 1 };
        case "post":
          return { seconds: between(15, 30), agentJobs: 1 };
        case "report":
          return { seconds: between(30, 60), agentJobs: 1 };
        case "monday":
          return { seconds: between(10, 25), agentJobs: 3 };
        default: // brief
          return { seconds: between(3, 8) };
      }
    default: // feedback, release_sends, weather, gm_alerts, health_check, cleanup
      return { seconds: between(0.3, 3) };
  }
}

type Event = { at: number; seq: number; run: () => Promise<void> };

async function simulate(opts: { failing?: string; ownerMessages: number; seed: number }) {
  const store = await import("@/lib/queue/store");
  const { plannedJobs, nextMorningStep, briefCheckTime, keys } = await import("@/lib/queue/rules");
  const { enqueueMorningStep } = await import("@/lib/queue/dispatch");
  const { WORKER } = await import("@/lib/queue/config");
  const rand = rng(opts.seed);

  const events: Event[] = [];
  let seq = 0;
  const at = (t: number, run: () => Promise<void>) => events.push({ at: t, seq: seq++, run });

  const briefDone = new Map<string, number>();
  const ownerWaits: number[] = [];
  const queuedAt = new Map<string, number>();
  let running = 0;
  let peakRunning = 0;
  let workersStarted = 0;
  let jobsRun = 0;
  let agentSeq = 0;
  const failures: string[] = [];

  // One worker: WORKER.lanes lanes, each taking a job, "working" for its time, then the next.
  const startWorker = (t0: number) => {
    workersStarted++;
    const worker = `sim-${workersStarted}`;
    const lane = async (t: number) => {
      if (t - t0 >= WORKER.claimForMs) return;
      const [job] = await store.claim({ worker, now: new Date(t) });
      if (!job) return;
      running++;
      peakRunning = Math.max(peakRunning, running);
      jobsRun++;
      if (job.type === "owner_message") ownerWaits.push((t - queuedAt.get(job.idempotency_key)!) / 1000);
      const step = typeof job.payload.step === "string" ? job.payload.step : undefined;
      const work = workFor(job.type, step, rand);
      at(t + work.seconds * 1000, async () => {
        const done = t + work.seconds * 1000;
        running--;
        const now = new Date(done);
        if (opts.failing === job.restaurant_id && step === "post") {
          const after = await store.fail(job.id, worker, "Claude timed out", true, now);
          failures.push(`${after?.status} after try ${job.attempts}`);
        } else {
          await store.complete(job.id, worker, null, now);
          for (let i = 0; i < (work.agentJobs ?? 0); i++) {
            await store.enqueue({ type: "agent", restaurantId: job.restaurant_id, key: `agent:sim:${agentSeq++}`, runAt: now });
          }
          if (job.type === "morning" && step) {
            const next = nextMorningStep(step as never, 1);
            if (next) await enqueueMorningStep(job.restaurant_id!, String(job.payload.day), next, now);
            else briefDone.set(job.restaurant_id!, done);
          }
        }
        await lane(done);
      });
    };
    for (let i = 0; i < WORKER.lanes; i++) at(t0, () => lane(t0));
  };

  // 9:05: the hourly job queues everything (as lib/queue/dispatch.ts does) and starts workers.
  at(START.getTime(), async () => {
    for (const id of ids) {
      for (const p of plannedJobs({ id, hasOwnerChannel: true }, "hourly", START, null)) {
        await store.enqueue({ type: p.type, restaurantId: id, key: p.key, priority: p.priority, concurrencyKey: p.concurrencyKey, payload: p.payload, runAt: START });
      }
    }
    await store.enqueue({ type: "health_check", restaurantId: null, key: keys.health("2026-10-12"), runAt: briefCheckTime(START) });
    await store.enqueue({ type: "cleanup", restaurantId: null, key: keys.cleanup("2026-10-12"), runAt: START });
    const n = await store.workersWanted(START);
    for (let i = 0; i < n; i++) startWorker(START.getTime());
  });
  // Every minute: Supabase starts workers_wanted() workers.
  for (let t = START.getTime() + 55_000; t < END.getTime(); t += 60_000) {
    at(t, async () => {
      const n = await store.workersWanted(new Date(t));
      for (let i = 0; i < n; i++) startWorker(t);
    });
  }
  // Owners writing in during the busiest minutes; each message starts a worker.
  for (let i = 0; i < opts.ownerMessages; i++) {
    const t = START.getTime() + Math.floor(rand() * 10 * 60_000);
    const id = ids[Math.floor(rand() * RESTAURANTS)];
    at(t, async () => {
      const key = `owner_message:SMsim${i}`;
      queuedAt.set(key, t);
      await store.enqueue({ type: "owner_message", restaurantId: id, key, priority: 0, concurrencyKey: `whatsapp:${id}`, runAt: new Date(t), payload: {} });
      startWorker(t);
    });
  }

  while (events.length) {
    events.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const e = events.shift()!;
    if (e.at > END.getTime()) break;
    await e.run();
  }

  const minutes = (t: number) => (t - START.getTime()) / 60_000;
  const briefTimes = [...briefDone.values()].map(minutes).sort((a, b) => a - b);
  const status = await pg.query<{ type: string; status: string; n: number }>("select type, status, count(*)::int as n from jobs group by 1, 2 order by 1, 2");
  return {
    briefs: briefDone,
    briefTimes,
    lastBrief: briefTimes.at(-1)!,
    medianBrief: briefTimes[Math.floor(briefTimes.length / 2)],
    ownerWaitMax: Math.max(...ownerWaits),
    ownerWaitMedian: ownerWaits.sort((a, b) => a - b)[Math.floor(ownerWaits.length / 2)],
    ownerMessages: ownerWaits.length,
    peakRunning,
    workersStarted,
    jobsRun,
    failures,
    jobs: status.rows,
  };
}

const fmt = (min: number) => {
  const total = Math.round(min * 60) + 5 * 60; // seconds after 9:00
  return `9:${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

describe("50 restaurants on a Monday morning", () => {
  test("every brief goes by 9:15, and owners' messages are answered first", async () => {
    const r = await simulate({ ownerMessages: 40, seed: 7 });
    console.log(
      [
        `Simulated Monday, ${RESTAURANTS} restaurants, ${r.jobsRun} jobs run, ${r.workersStarted} worker calls, at most ${r.peakRunning} jobs at once.`,
        `Briefs: first ${fmt(r.briefTimes[0])}, median ${fmt(r.medianBrief)}, last ${fmt(r.lastBrief)}.`,
        `Owner messages (${r.ownerMessages}): waited for a worker ${r.ownerWaitMedian.toFixed(1)}s median, ${r.ownerWaitMax.toFixed(1)}s at most.`,
      ].join("\n"),
    );
    expect(r.briefs.size).toBe(RESTAURANTS);
    for (const t of r.briefs.values()) expect(t).toBeLessThanOrEqual(BRIEF_BY.getTime());
    // Most start at once; the longest waits are a second message from the same owner,
    // which waits for their first to be answered (messages are answered in order).
    expect(r.ownerWaitMedian).toBeLessThan(1);
    expect(r.ownerWaitMax).toBeLessThan(30);
  });

  test("one restaurant failing all morning doesn't delay the other 49", async () => {
    const failing = ids[0];
    const r = await simulate({ failing, ownerMessages: 40, seed: 7 });
    console.log(`With R1's post failing every time: R1's post step ${r.failures.join(", ")}; the other briefs: median ${fmt(r.medianBrief)}, last ${fmt(r.lastBrief)}.`);
    expect(r.briefs.has(failing)).toBe(false);
    expect(r.briefs.size).toBe(RESTAURANTS - 1);
    for (const t of r.briefs.values()) expect(t).toBeLessThanOrEqual(BRIEF_BY.getTime());
    // Its retries (1, 5, 15 minutes...) carry on; the step dies after 5 tries (the builder is told then, and at 9:31).
    expect(r.failures.slice(0, 4)).toEqual(["queued after try 1", "queued after try 2", "queued after try 3", "queued after try 4"]);
  });
});
