import type { NextRequest } from "next/server";
import { logAction } from "@/lib/audit";
import { enqueueBackfill } from "@/lib/feeds/backfill";
import { runFeedNow } from "@/lib/feeds/builder";
import { FEED_NAMES, type FeedName } from "@/lib/feeds/config";
import { coverageFor } from "@/lib/feeds/coverage-data";
import { feedStatuses } from "@/lib/feeds/status";
import { kickWorkers } from "@/lib/queue/kick";

// The outside data feeds by hand (scripts/run-feed.mjs). Needs the CRON_SECRET password.
//   GET  ?status=1                    each feed's status row
//   GET  ?coverage=<restaurant id>    which model factors have data for the next 14 days (&days=N)
//   POST ?run=<feed|all>              run a feed now (weather, calendar, prayer, football,
//                                     events, disruption, school_terms)
//   POST ?backfill=<restaurant id>    fill a restaurant's history (weather, prayer times, calendar)
function authorised(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new Response("Unauthorized", { status: 401 });
  const p = req.nextUrl.searchParams;
  const r = p.get("coverage");
  if (r) {
    if (!UUID.test(r)) return new Response("Bad restaurant id", { status: 400 });
    return Response.json(await coverageFor(r, new Date(), Math.min(60, Math.max(1, Number(p.get("days")) || 14))));
  }
  return Response.json({ feeds: await feedStatuses() });
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return new Response("Unauthorized", { status: 401 });
  const p = req.nextUrl.searchParams;
  const run = p.get("run");
  if (run) {
    if (run !== "all" && !(FEED_NAMES as readonly string[]).includes(run)) return new Response("Unknown feed", { status: 400 });
    const queued = await runFeedNow(run as FeedName | "all");
    await logAction({ restaurantId: null, actor: "builder", action: "builder_command", detail: `Ran the ${run} feed by hand`, data: { queued } });
    return Response.json({ run, queued });
  }
  const r = p.get("backfill");
  if (r) {
    if (!UUID.test(r)) return new Response("Bad restaurant id", { status: 400 });
    const job = await enqueueBackfill(r, "builder");
    await kickWorkers(1);
    await logAction({ restaurantId: r, actor: "builder", action: "builder_command", detail: "Queued the outside data backfill by hand" });
    return Response.json({ backfill: r, queued: Boolean(job), note: job ? "queued" : "already queued today" });
  }
  return new Response("Say what to run: ?run=<feed> or ?backfill=<restaurant id>", { status: 400 });
}
