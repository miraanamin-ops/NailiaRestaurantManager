// Real Claude reading the sample till reports and the sample POS export.
// Not part of npm test (it costs a little). Run with:
//   node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.e2e.config.mts tests/e2e/sales.e2e.ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { readZReport, suggestMapping } from "@/lib/sales/ai";
import { applyMapping, mappingWorks, parseCsv, sampleForAi, toTable } from "@/lib/sales/pos-table";
import { checkZReport, confirmQuestion, dateQuestion, savedLine, UNREADABLE_REPLY } from "@/lib/sales/z-check";

const TODAY = "2026-10-10";

async function readSample(name: string) {
  const bytes = readFileSync(`public/samples/z-report-${name}.jpg`);
  const read = await readZReport({ base64: bytes.toString("base64"), mediaType: "image/jpeg" }, TODAY);
  const check = checkZReport(read, TODAY);
  const reply =
    check.status === "ok"
      ? savedLine(check.figures, TODAY)
      : check.status === "needs_confirm"
        ? confirmQuestion(check.figures, check.problems, TODAY)
        : check.status === "needs_date"
          ? dateQuestion(check.figures, TODAY)
          : check.status === "unreadable"
            ? UNREADABLE_REPLY
            : "(not a till report)";
  console.log(`\n--- sample ${name} ---\nread: ${JSON.stringify(read)}\nreply: ${reply}`);
  return { read, check, reply };
}

describe("Claude reads the sample till reports", () => {
  test.concurrent("sample 1: Thu 8 Oct, a classic Z reading", async () => {
    const { reply } = await readSample("1");
    expect(reply).toBe("Thu 8 Oct: £2,808.00 sales, £468.00 VAT, £2,340.00 net, 118 transactions. Saved.");
  });

  test.concurrent("sample 2: Fri 9 Oct, with sales by hour and a delivery app", async () => {
    const { reply, read } = await readSample("2");
    expect(reply).toBe("Fri 9 Oct: £4,236.60 sales, £706.10 VAT, £3,530.50 net, 171 transactions. Saved.");
    expect(read.hourly).toHaveLength(10);
  });

  test.concurrent("sample 3: Cardamom Corner, Wed 7 Oct", async () => {
    const { reply } = await readSample("3");
    expect(reply).toBe("Wed 7 Oct: £1,064.85 sales, £177.47 VAT, £887.38 net, 112 transactions. Saved.");
  });

  test.concurrent("the bad photo gets a question, not a save", async () => {
    const { check } = await readSample("bad");
    expect(["unreadable", "needs_confirm", "needs_date"]).toContain(check.status);
  });
});

test("Claude works out the sample POS export's columns", async () => {
  const table = toTable(parseCsv(readFileSync("public/samples/pos-export-sample.csv", "utf8")))!;
  const suggestion = await suggestMapping(sampleForAi(table));
  console.log("\n--- POS mapping ---\n", JSON.stringify(suggestion));
  expect(suggestion.mapping).not.toBeNull();
  expect(mappingWorks(table, suggestion.mapping!)).toBe(true);
  const { lines } = applyMapping(table, suggestion.mapping!);
  expect(lines).toHaveLength(522);
  expect(Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100).toBe(4571.25);
});
