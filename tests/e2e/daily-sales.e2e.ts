// Does the REAL Claude recognise each daily takings sample as daily totals, with
// the right date and takings columns? One small call per file (about $0.02 in all).
// The samples: tests/fixtures/sales/ (each till's usual layout, not real exports).
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/daily-sales.e2e.ts
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import { applyMapping, mappingWorks, parseCsv, sampleForAi, toTable } from "@/lib/sales/pos-table";

beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Needs ANTHROPIC_API_KEY (run with --env-file=.env.local)");
});

const SAMPLES = [
  { name: "square-sales-summary.csv", takings: ["Gross Sales", "Total Collected", "Net Sales"] },
  { name: "lightspeed-monthly-turnover.csv", takings: ["Turnover incl. VAT"] },
  { name: "epos-now-sales-report.csv", takings: ["Total", "Gross Sales"] },
  { name: "messy-daily-takings.csv", takings: ["Takings"] },
];

describe("the real column reader on daily takings", () => {
  for (const s of SAMPLES) {
    test(s.name, async () => {
      const table = toTable(parseCsv(readFileSync(`tests/fixtures/sales/${s.name}`, "utf8")))!;
      const { suggestMapping } = await import("@/lib/sales/ai");
      const out = await suggestMapping(sampleForAi(table));
      console.log(`${s.name}: ${JSON.stringify(out)}`);
      expect(out.mapping).toMatchObject({ item: null });
      expect(s.takings).toContain(out.mapping!.price);
      expect(mappingWorks(table, out.mapping!)).toBe(true);
      expect(applyMapping(table, out.mapping!).lines).toHaveLength(70);
    });
  }
});
