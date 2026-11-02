// "How you compare nearby" in the monthly report (docs/monthly-report.md): one
// restaurant's month against other DinerAI restaurants near it. Plain code with no
// imports beyond types, unit-tested in tests/benchmark.test.ts.
//
// Privacy rules (never relax these without the user):
//   - only medians and where you stand: never another restaurant's name or figure
//   - at least MIN_PEERS other restaurants in the group, and for every metric
//   - changes and percentages, never takings in £ (average order is the one £ median)
//   - real restaurants only compare with real ones; demo and test sites only with each other
//   - a restaurant that opts out is in nobody's group and gets no comparison itself

import type { MonthlyFigures } from "./monthly-rules";

export const MIN_PEERS = 5;
export const RADII_MILES = [1, 2, 3];

export type Place = { id: string; latitude: number | null; longitude: number | null };

// Straight-line distance in miles.
export function distanceMiles(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The nearest radius (1, then 2, then 3 miles) with at least MIN_PEERS others in it.
// null: not enough restaurants nearby yet.
export function pickGroup<T extends Place>(self: Place, others: T[]): { radius: number; peers: T[] } | null {
  if (self.latitude == null || self.longitude == null) return null;
  const here = { latitude: self.latitude, longitude: self.longitude };
  const placed = others
    .filter((o) => o.id !== self.id && o.latitude != null && o.longitude != null)
    .map((o) => ({ o, miles: distanceMiles(here, { latitude: o.latitude!, longitude: o.longitude! }) }));
  for (const radius of RADII_MILES) {
    const peers = placed.filter((p) => p.miles <= radius).map((p) => p.o);
    if (peers.length >= MIN_PEERS) return { radius, peers };
  }
  return null;
}

// One restaurant's month, as compared. null where it has no figure.
export type PeerMetrics = {
  lfl: number | null; // takings vs last month, like for like (%)
  yoy: number | null; // vs the same month last year, like for like (%)
  goodReviews: number | null; // new 4 and 5 star Google reviews this month
  rating: number | null; // Google rating
  replyRate: number | null; // % of this month's reviews replied to
  avgOrder: number | null; // £
};

type Review = { date: string; rating: number | null; replied_at: string | null };

export function peerMetrics(f: MonthlyFigures | null, reviews: Review[], rating: number | null, month: string): PeerMetrics {
  const mine = reviews.filter((r) => r.date.startsWith(month));
  return {
    lfl: f?.vsLastMonth?.likeForLike ?? null,
    yoy: f?.vsLastYear?.likeForLike ?? null,
    goodReviews: mine.filter((r) => (r.rating ?? 0) >= 4).length,
    rating: rating ?? null,
    replyRate: mine.length >= 3 ? Math.round((mine.filter((r) => r.replied_at).length / mine.length) * 100) : null,
    avgOrder: f?.avgOrder ?? null,
  };
}

const METRICS: { key: keyof PeerMetrics; label: string; show: (n: number) => string; same: number }[] = [
  { key: "lfl", label: "Takings vs last month (like for like)", show: (n) => `${n >= 0 ? "+" : "-"}${Math.abs(Math.round(n * 10) / 10)}%`, same: 1 },
  { key: "yoy", label: "Takings vs same month last year", show: (n) => `${n >= 0 ? "+" : "-"}${Math.abs(Math.round(n * 10) / 10)}%`, same: 1 },
  { key: "goodReviews", label: "New 4 and 5 star Google reviews", show: (n) => String(Math.round(n)), same: 0.5 },
  { key: "rating", label: "Google rating", show: (n) => n.toFixed(1), same: 0.1 },
  { key: "replyRate", label: "Reviews replied to", show: (n) => `${Math.round(n)}%`, same: 5 },
  { key: "avgOrder", label: "Average order", show: (n) => `£${Math.round(n)}`, same: 0.5 },
];

export type Position = "Top quarter" | "Above most" | "About the same" | "Below most" | "Bottom quarter";
export type BenchmarkRow = { key: keyof PeerMetrics; label: string; you: string; nearby: string; position: Position };
export type Benchmark = { radiusMiles: number; restaurants: number; rows: BenchmarkRow[] };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// Where `you` stands among the others: the share of them below you.
function position(you: number, values: number[], med: number, same: number): Position {
  if (Math.abs(you - med) <= same) return "About the same";
  const below = values.filter((v) => v < you).length / values.length;
  if (below >= 0.75) return "Top quarter";
  if (below >= 0.5) return "Above most";
  if (below > 0.25) return "Below most";
  return "Bottom quarter";
}

// The comparison rows. A metric shows only when you have a figure and at least
// MIN_PEERS others do too. null: nothing to show.
export function compareToPeers(you: PeerMetrics, peers: PeerMetrics[], radiusMiles: number): Benchmark | null {
  if (peers.length < MIN_PEERS) return null;
  const rows: BenchmarkRow[] = [];
  for (const m of METRICS) {
    const mine = you[m.key];
    const values = peers.map((p) => p[m.key]).filter((v): v is number => v != null);
    if (mine == null || values.length < MIN_PEERS) continue;
    const med = median(values);
    rows.push({ key: m.key, label: m.label, you: m.show(mine), nearby: m.show(med), position: position(mine, values, med, m.same) });
  }
  return rows.length ? { radiusMiles, restaurants: peers.length, rows } : null;
}

export const benchmarkTitle = (b: Benchmark) => `Compared with ${b.restaurants} DinerAI restaurants within ${b.radiusMiles} mile${b.radiusMiles === 1 ? "" : "s"}`;

// For Claude's facts (the highlights can use it).
export const benchmarkFacts = (b: Benchmark) =>
  `${benchmarkTitle(b)} (medians): ${b.rows.map((r) => `${r.label}: you ${r.you}, nearby ${r.nearby} (${r.position.toLowerCase()})`).join("; ")}.`;

// Colours for "where you stand" (green above, red below).
export const STAND: Record<Position, string> = { "Top quarter": "#047857", "Above most": "#047857", "About the same": "#57534e", "Below most": "#b91c1c", "Bottom quarter": "#b91c1c" };

// Who can be in whose group: live, not opted out, and real with real (demo and test
// sites only with each other, so test data never reaches a real owner's report).
type Comparable = { active: boolean; benchmark_opt_out?: boolean | null; is_demo?: boolean | null; is_test?: boolean | null };
export const canCompare = (self: Comparable, other: Comparable) =>
  other.active && !other.benchmark_opt_out && !!other.is_demo === !!self.is_demo && !!other.is_test === !!self.is_test;
