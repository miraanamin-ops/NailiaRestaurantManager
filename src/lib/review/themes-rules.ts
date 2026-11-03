// What customers say, as pure rules: the themes a review can be tagged with,
// the checks on the tagger's answer, the counts (code, never AI), and the check
// on the summary. No imports, so it's unit-tested.

export const THEMES = ["food", "service", "speed", "value", "cleanliness", "atmosphere", "dish"] as const;
export type ThemeKey = (typeof THEMES)[number];
export type Sentiment = "positive" | "negative";
export type ThemeTag = { theme: ThemeKey; sentiment: Sentiment; dish?: string | null };
export type ReviewTag = { review_id: string; themes: ThemeTag[]; sentiment: "positive" | "mixed" | "negative" };
export type TagReview = { id: string; rating: number | null; text: string | null };

// The words code uses for each theme (the summary's labels come from here).
const PRAISE: Record<Exclude<ThemeKey, "dish">, string> = {
  food: "The food",
  service: "Friendly service",
  speed: "Quick service",
  value: "Good value",
  cleanliness: "How clean it is",
  atmosphere: "The atmosphere",
};
const COMPLAINT: Record<Exclude<ThemeKey, "dish">, string> = {
  food: "The food",
  service: "The service",
  speed: "Waiting times",
  value: "Prices",
  cleanliness: "Cleanliness",
  atmosphere: "The atmosphere",
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// The tagger's answer for one batch: every review in it once, known themes only,
// and a named dish only if the review's own words name it.
export function tagProblems(batch: TagReview[], out: ReviewTag[]): string[] {
  const p: string[] = [];
  const ids = new Set(batch.map((r) => r.id));
  const seen = new Set<string>();
  for (const t of out) {
    if (!ids.has(t.review_id)) p.push(`Review ${t.review_id} isn't in this batch.`);
    if (seen.has(t.review_id)) p.push(`Review ${t.review_id} is tagged twice.`);
    seen.add(t.review_id);
    const text = norm(batch.find((r) => r.id === t.review_id)?.text ?? "");
    for (const th of t.themes) {
      if (!(THEMES as readonly string[]).includes(th.theme)) p.push(`Unknown theme "${th.theme}".`);
      if (th.theme === "dish") {
        if (!th.dish?.trim()) p.push(`Review ${t.review_id}: a dish theme needs the dish's name.`);
        else if (!text.includes(norm(th.dish))) p.push(`Review ${t.review_id}: "${th.dish}" isn't in the review's words.`);
      }
    }
  }
  for (const id of ids) if (!seen.has(id)) p.push(`Review ${id} wasn't tagged.`);
  return p;
}

export type ThemeCount = { label: string; count: number; example: string | null; reviewIds: string[] };

const labelOf = (t: ThemeTag, praise: boolean) => (t.theme === "dish" ? (t.dish ?? "").trim().replace(/^./, (c) => c.toUpperCase()) : (praise ? PRAISE : COMPLAINT)[t.theme]);

// A short quote: the review's first sentence that names it, or its start.
function exampleFrom(text: string | null, label: string) {
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const word = norm(label).split(" ").at(-1) ?? "";
  const s = sentences.find((x) => norm(x).includes(word)) ?? sentences[0];
  const clipped = s.length > 120 ? `${s.slice(0, 117).replace(/\s+\S*$/, "")}...` : s;
  return clipped.trim();
}

// The counts, from the tags: one count per review per label.
export function countThemes(tags: ReviewTag[], reviews: TagReview[]) {
  const byId = new Map(reviews.map((r) => [r.id, r]));
  const tally = (praise: boolean) => {
    const m = new Map<string, ThemeCount>();
    for (const t of tags) {
      for (const th of t.themes) {
        if ((th.sentiment === "positive") !== praise) continue;
        const label = labelOf(th, praise);
        if (!label) continue;
        const key = norm(label);
        const row = m.get(key) ?? { label, count: 0, example: null, reviewIds: [] };
        if (row.reviewIds.includes(t.review_id)) continue;
        row.reviewIds.push(t.review_id);
        row.count++;
        row.example ??= exampleFrom(byId.get(t.review_id)?.text ?? null, label);
        m.set(key, row);
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  return { praises: tally(true), complaints: tally(false) };
}

// The summary's check: every number is a count from the tags; anything in
// quotes is a customer's own words; no dish from the menu that the tags don't name.
export function summaryProblems(text: string, counts: ReturnType<typeof countThemes>, reviewTexts: string[], menuDishes: string[]): string[] {
  const p: string[] = [];
  const all = [...counts.praises, ...counts.complaints];
  const allowed = new Set(all.map((c) => String(c.count)));
  for (const n of text.match(/\d+/g) ?? []) if (!allowed.has(n)) p.push(`The number ${n} isn't a count from the tags.`);
  const corpus = norm(reviewTexts.join(" \n "));
  for (const q of text.match(/["“]([^"”]{4,})["”]/g) ?? []) {
    const inner = norm(q.slice(1, -1).replace(/\.\.\.$/, ""));
    if (!corpus.includes(inner)) p.push(`"${q.slice(1, -1)}" isn't a customer's own words.`);
  }
  const labels = all.map((c) => norm(c.label));
  for (const d of menuDishes) {
    const dn = norm(d);
    if (dn.length > 3 && norm(text).includes(dn) && !labels.some((l) => l.includes(dn) || dn.includes(l))) p.push(`"${d}" isn't something the reviews mention.`);
  }
  if (text.includes("—")) p.push("No em-dashes.");
  return p;
}
