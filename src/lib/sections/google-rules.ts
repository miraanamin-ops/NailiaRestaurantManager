// The Monday report's Google section (docs/pilot-sprint.md, "Weekly report"):
// rating, new reviews, replies sent, calls, direction requests, views and 3
// review themes. Themes come from the Reputation agent's weekly themes when it
// has them; otherwise these plain-code ones (words in the week's reviews).
// No imports, so it's unit-tested (tests/report-sections.test.ts).

type Review = { rating: number; text: string | null };

const THEMES: { label: string; words: RegExp }[] = [
  { label: "the food", words: /\b(food|tast(y|e|ed)|delicious|flavou?r|fresh|cooked|grill|curry|burger|chips|naan|lassi|tikka|kebab|chops)\b/i },
  { label: "the staff and service", words: /\b(staff|service|friendly|rude|welcom(e|ing)|helpful|waiter|polite|attentive)\b/i },
  { label: "waiting times", words: /\b(wait(ed|ing)?|slow|quick|fast|late|took ages|forever)\b/i },
  { label: "price and value", words: /\b(price|pricey|expensive|cheap|value|worth|overpriced)\b/i },
  { label: "portion sizes", words: /\b(portion|portions|generous|small|huge|filling)\b/i },
  { label: "cleanliness", words: /\b(clean|dirty|hygiene|filthy|spotless)\b/i },
  { label: "the atmosphere", words: /\b(atmosphere|vibe|music|cosy|cozy|noisy|decor|ambience)\b/i },
  { label: "delivery and takeaway", words: /\b(delivery|delivered|takeaway|take-away|collection|uber|deliveroo|just eat)\b/i },
];

export type Theme = { label: string; count: number; tone: "praised" | "complaint" | "mixed" };

// The 3 themes most reviews mention, each praised (4 to 5 stars), a complaint (1 to 3) or mixed.
export function keywordThemes(reviews: Review[], max = 3): Theme[] {
  const out: Theme[] = [];
  for (const t of THEMES) {
    const hits = reviews.filter((r) => r.text && t.words.test(r.text));
    if (!hits.length) continue;
    const good = hits.filter((r) => r.rating >= 4).length;
    const bad = hits.length - good;
    out.push({ label: t.label, count: hits.length, tone: bad === 0 ? "praised" : good === 0 ? "complaint" : "mixed" });
  }
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, max);
}

// The agent's themes as the same shape: the 3 mentioned most, praise or complaint.
export function agentThemes(t: { praise: { label: string; count: number }[]; complaints: { label: string; count: number }[] }, max = 3): Theme[] {
  return [
    ...t.praise.map((x) => ({ label: x.label, count: x.count, tone: "praised" as const })),
    ...t.complaints.map((x) => ({ label: x.label, count: x.count, tone: "complaint" as const })),
  ]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, max);
}

export function themeText(t: Theme) {
  const n = `${t.count} review${t.count === 1 ? "" : "s"}`;
  return t.tone === "praised" ? `${cap(t.label)}: praised (${n})` : t.tone === "complaint" ? `${cap(t.label)}: complaints (${n})` : `${cap(t.label)}: mixed (${n})`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type Insights = { views: number; calls: number; directions: number };

// Dummy Google insights for a demo restaurant in test mode: the same numbers
// every time for the same restaurant and week, roughly a busy local listing's.
export function dummyInsights(restaurantId: string, weekStart: string): Insights {
  const f = (base: number, spread: number, salt: string) => Math.round(base + (hash01(`${restaurantId}:${weekStart}:${salt}`) - 0.5) * 2 * spread);
  return { views: f(1150, 150, "views"), calls: f(24, 6, "calls"), directions: f(40, 8, "directions") };
}

// 0 to 1, well mixed (FNV-1a and a final shuffle), so next week's figure isn't last week's.
function hash01(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function insightsLine(now: Insights, before: Insights | null) {
  const b = (n: number) => (before ? ` (was ${n.toLocaleString("en-GB")})` : "");
  return `Calls ${now.calls}${b(before?.calls ?? 0)} · direction requests ${now.directions}${b(before?.directions ?? 0)} · profile views ${now.views.toLocaleString("en-GB")}${b(before?.views ?? 0)}`;
}
