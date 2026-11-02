// "How you compare nearby" in the monthly report (lib/report/benchmark-rules.ts):
// who's in the group, the radius widening, the privacy rules (5 or more, medians
// only), and where you stand.
import { describe, expect, test } from "vitest";
import { canCompare, compareToPeers, distanceMiles, MIN_PEERS, peerMetrics, pickGroup, type PeerMetrics } from "@/lib/report/benchmark-rules";

// Whitechapel; 0.01 degrees of latitude is about 0.69 miles.
const HERE = { id: "me", latitude: 51.5194, longitude: -0.0597 };
const at = (id: string, northMiles: number) => ({ id, latitude: HERE.latitude + northMiles / 69, longitude: HERE.longitude });
const metrics = (o: Partial<PeerMetrics>): PeerMetrics => ({ lfl: null, yoy: null, goodReviews: null, rating: null, replyRate: null, avgOrder: null, ...o });

describe("who's nearby", () => {
  test("distance in miles", () => {
    expect(distanceMiles(HERE, at("x", 1))).toBeCloseTo(1, 1);
  });

  test("1 mile when there are 5 others in it; widens to 2 then 3; nothing beyond", () => {
    const close = [0.2, 0.4, 0.6, 0.8, 0.9].map((m, i) => at(`c${i}`, m));
    expect(pickGroup(HERE, close)).toMatchObject({ radius: 1 });
    const spread = [0.5, 0.9, 1.5, 1.8, 1.9, 2.5].map((m, i) => at(`s${i}`, m));
    const two = pickGroup(HERE, spread)!;
    expect(two.radius).toBe(2);
    expect(two.peers.map((p) => p.id)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(pickGroup(HERE, [0.5, 1.5, 2.5, 2.9, 3.5, 4].map((m, i) => at(`f${i}`, m)))).toBeNull(); // only 4 within 3 miles
  });

  test("never counts itself, or a restaurant without a location", () => {
    const others = [HERE, ...[0.1, 0.2, 0.3].map((m, i) => at(`a${i}`, m)), { id: "nowhere", latitude: null, longitude: null }];
    expect(pickGroup(HERE, others)).toBeNull();
    expect(pickGroup({ id: "me", latitude: null, longitude: null }, [0.1, 0.2, 0.3, 0.4, 0.5].map((m, i) => at(`a${i}`, m)))).toBeNull();
  });

  test("real restaurants only with real ones, test sites only with test sites; opted out or inactive: in nobody's group", () => {
    const real = { active: true };
    expect(canCompare(real, { active: true })).toBe(true);
    expect(canCompare(real, { active: true, is_demo: true })).toBe(false);
    expect(canCompare(real, { active: true, is_demo: true, is_test: true })).toBe(false);
    expect(canCompare({ active: true, is_demo: true }, { active: true, is_demo: true })).toBe(true);
    expect(canCompare(real, { active: true, benchmark_opt_out: true })).toBe(false);
    expect(canCompare(real, { active: false })).toBe(false);
  });
});

describe("the comparison", () => {
  const peers = [2, 4, 6, 8, 10].map((lfl, i) => metrics({ lfl, avgOrder: 15 + i, goodReviews: i, rating: 4.1 + i / 10 }));

  test("medians only, with where you stand", () => {
    const b = compareToPeers(metrics({ lfl: 9, avgOrder: 14, goodReviews: 2, rating: 4.3 }), peers, 1)!;
    expect(b).toMatchObject({ radiusMiles: 1, restaurants: 5 });
    const row = (k: string) => b.rows.find((r) => r.key === k)!;
    expect(row("lfl")).toMatchObject({ you: "+9%", nearby: "+6%", position: "Top quarter" });
    expect(row("avgOrder")).toMatchObject({ you: "£14", nearby: "£17", position: "Bottom quarter" });
    expect(row("goodReviews")).toMatchObject({ you: "2", nearby: "2", position: "About the same" });
    expect(row("rating")).toMatchObject({ nearby: "4.3", position: "About the same" });
    // No other restaurant's own figure appears anywhere: only "you" and the median.
    const shown = b.rows.flatMap((r) => [r.you, r.nearby]);
    expect(shown).not.toContain("+2%");
    expect(shown).not.toContain("+10%");
  });

  test(`a metric needs ${MIN_PEERS} others with a figure; your own missing figure hides it too`, () => {
    const partial = peers.map((p, i) => ({ ...p, yoy: i < 4 ? 5 : null, replyRate: 50 }));
    const b = compareToPeers(metrics({ lfl: 3, yoy: 8 }), partial, 2)!;
    expect(b.rows.map((r) => r.key)).toEqual(["lfl"]); // yoy: only 4 others; replyRate and the rest: you have none
  });

  test(`fewer than ${MIN_PEERS} others, or nothing to compare: no section`, () => {
    expect(compareToPeers(metrics({ lfl: 3 }), peers.slice(0, 4), 1)).toBeNull();
    expect(compareToPeers(metrics({}), peers, 1)).toBeNull();
  });

  test("a restaurant's metrics: 4 and 5 star reviews this month; reply rate from 3 reviews up", () => {
    const reviews = [
      { date: "2026-10-02T10:00:00Z", rating: 5, replied_at: "2026-10-02T12:00:00Z" },
      { date: "2026-10-09T10:00:00Z", rating: 4, replied_at: null },
      { date: "2026-10-20T10:00:00Z", rating: 2, replied_at: "2026-10-21T09:00:00Z" },
      { date: "2026-09-30T10:00:00Z", rating: 5, replied_at: null },
    ];
    expect(peerMetrics(null, reviews, 4.4, "2026-10")).toEqual({ lfl: null, yoy: null, goodReviews: 2, rating: 4.4, replyRate: 67, avgOrder: null });
    expect(peerMetrics(null, reviews.slice(0, 2), null, "2026-10").replyRate).toBeNull();
  });
});
