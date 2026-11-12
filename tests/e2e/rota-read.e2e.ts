// How well past rotas are read (owner's plan, 12 Nov 2026), with the REAL Claude:
// the synthetic generator's messy rota photos (skewed, rows not quite lined up with
// the names) are read by readRotaFiles exactly as at setup, and every shift is
// compared with the right answer (the CSV of the same week). The database is the
// in-memory stand-in; only Claude is real (about 15 to 25p a run). Run with:
//   E2E_ROTA_DIR=<generator output>/halal_ilford_messy/inputs/rotas node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/rota-read.e2e.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { parseCsv } from "@/lib/sales/pos-table";
import { memoryDb } from "../support/memory-db";

const DIR = process.env.E2E_ROTA_DIR ?? "";
const R = "dddddddd-0000-4000-8000-0000000e2e07";

// The right answers: each CSV is a week (header row "Name, Mon 14 Sep, ..."; cells "15:00-23:30" or OFF).
function answers(): { name: string; date: string; start: string; end: string }[] {
  const out: { name: string; date: string; start: string; end: string }[] = [];
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".csv"))) {
    const monday = f.match(/(\d{4}-\d{2}-\d{2})/)![1];
    const rows = parseCsv(readFileSync(join(DIR, f), "utf8"));
    const head = rows.findIndex((r) => r[0] === "Name");
    for (const row of rows.slice(head + 1)) {
      if (!row[0]) continue;
      for (let d = 0; d < 7; d++) {
        const cell = (row[d + 1] ?? "").trim();
        const m = cell.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
        if (!m) continue;
        const date = new Date(Date.parse(`${monday}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
        out.push({ name: row[0].trim(), date, start: m[1].padStart(5, "0"), end: m[2].padStart(5, "0") });
      }
    }
  }
  return out;
}

const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

test.skipIf(!DIR)("the messy rota photos are read shift by shift", async () => {
  const db = memoryDb({
    restaurants: [{ id: R, name: "Saffron Lane", slug: "saffron-lane-e2e", is_demo: true }],
    onboarding_sessions: [{ restaurant_id: R, flow_version: 2, current_step: "team", started_at: new Date().toISOString(), completed_at: null }],
    onboarding_steps: [{ restaurant_id: R, step_key: "team", status: "in_progress", data: {} }],
    onboarding_ai_usage: [],
  });
  vi.doMock("@/lib/supabase", async (orig) => ({ ...(await orig<object>()), getSupabase: () => db.client }));
  vi.doMock("@/lib/onboarding/dina/uploads-store", async (orig) => ({ ...(await orig<object>()), readSavedFile: async (_r: string, path: string) => readFileSync(path) }));
  const photos = readdirSync(DIR)
    .filter((x) => x.endsWith(".jpg"))
    .sort()
    .map((f) => ({ type: "file" as const, path: join(DIR, f), kind: "photo" as const, contentType: "image/jpeg", bytes: 0 }));
  const { readRotaFiles } = await import("@/lib/rota/import");
  const read = await readRotaFiles(R, photos);
  expect(read.ok).toBe(true);
  const imp = (db.tables.onboarding_steps[0].data as { rota_import: { doubts?: string[]; shifts: { name: string; date: string; start: number; end: number }[] } }).rota_import;
  const got = imp.shifts;
  const want = answers();
  const key = (s: { name: string; date: string; start: string; end: string }) => `${s.name.toLowerCase()}|${s.date}|${s.start}|${s.end}`;
  const gotKeys = new Set(got.map((s) => key({ name: s.name, date: s.date, start: hhmm(s.start), end: hhmm(s.end) })));
  const wantKeys = new Set(want.map(key));
  const right = [...wantKeys].filter((k) => gotKeys.has(k)).length;
  const extra = [...gotKeys].filter((k) => !wantKeys.has(k));
  const missed = [...wantKeys].filter((k) => !gotKeys.has(k));
  const cost = (db.tables.onboarding_ai_usage as { cost_usd: number }[]).reduce((n, x) => n + Number(x.cost_usd), 0);
  console.log(`Rota reading: ${right} of ${wantKeys.size} shifts exactly right (${((right / wantKeys.size) * 100).toFixed(1)}%), ${extra.length} read that aren't there, cost $${cost.toFixed(3)}`);
  console.log(`Missed (first 10): ${missed.slice(0, 10).join("; ")}`);
  console.log(`Extra (first 10): ${extra.slice(0, 10).join("; ")}`);
  // Every person with a wrong shift is named on the check card (their row doesn't add up to the printed hours).
  const wrongPeople = [...new Set([...missed, ...extra].map((k) => k.split("|")[0]))].filter((n) => !/^open shift/.test(n));
  const flagged = new Set((imp.doubts ?? []).map((n) => n.toLowerCase()));
  console.log(`People with a wrong shift: ${wrongPeople.join(", ") || "none"}; flagged on the card: ${[...flagged].join(", ") || "none"}`);
  // A bar for the first owner tests: most shifts right, and every misread row flagged for the owner to check.
  expect(right / wantKeys.size).toBeGreaterThan(0.85);
  expect(wrongPeople.filter((n) => !flagged.has(n))).toEqual([]);
});
