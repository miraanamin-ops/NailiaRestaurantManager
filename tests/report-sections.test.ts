// The Monday report's pilot sections and their wiring (docs/pilot-sprint.md,
// "Finance forecast and calendar"): the Google section's themes and dummy
// numbers, the registry (what each section replaces, its suggested actions),
// the WhatsApp version (never over 25 lines), LABOUR TARGET, and migration 046
// with its rollback on the full chain in PGlite.
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { newFullDb, readMigration } from "./support/full-pg";
import { parseCommand } from "@/lib/bot/parse";
import { agentThemes, dummyInsights, insightsLine, keywordThemes, themeText } from "@/lib/sections/google-rules";
import { runReportSections, type ReportSectionDef } from "@/lib/sections/types";
import type { ReportData } from "@/lib/report/types";
import type { Restaurant } from "@/lib/supabase";
import type { Period } from "@/lib/report/build";

describe("the Google section's pieces", () => {
  test("plain-code themes: the 3 mentioned most, praised or complained about", () => {
    const themes = keywordThemes([
      { rating: 5, text: "Delicious food and friendly staff" },
      { rating: 5, text: "The food was fresh" },
      { rating: 2, text: "Food was cold and we waited ages, slow service" },
      { rating: 4, text: "Good value" },
      { rating: 3, text: null },
    ]);
    expect(themes.map(themeText)).toEqual(["The food: mixed (3 reviews)", "The staff and service: mixed (2 reviews)", "Price and value: praised (1 review)"]);
    expect(keywordThemes([])).toEqual([]);
  });

  test("the agent's themes, when it has them, in the same shape", () => {
    const t = agentThemes({ praise: [{ label: "the lamb chops", count: 4 }, { label: "quick service", count: 1 }], complaints: [{ label: "parking", count: 2 }] });
    expect(t.map(themeText)).toEqual(["The lamb chops: praised (4 reviews)", "Parking: complaints (2 reviews)", "Quick service: praised (1 review)"]);
  });

  test("dummy insights: the same every time for a restaurant and week, different week to week", () => {
    const a = dummyInsights("r1", "2026-10-19");
    expect(dummyInsights("r1", "2026-10-19")).toEqual(a);
    expect(dummyInsights("r1", "2026-10-26")).not.toEqual(a);
    expect(a.views).toBeGreaterThan(900);
    expect(insightsLine({ views: 1200, calls: 22, directions: 35 }, { views: 1100, calls: 19, directions: 47 })).toBe(
      "Calls 22 (was 19) · direction requests 35 (was 47) · profile views 1,200 (was 1,100)",
    );
  });
});

describe("the registry", () => {
  const input = { restaurant: { id: "r" } as Restaurant, period: {} as Period };
  test("what a section replaces and its own actions are collected only when it's built", async () => {
    const defs: ReportSectionDef[] = [
      { id: "a", order: 1, replaces: ["reputation"], build: async () => ({ title: "A", stats: [], lines: ["x"] }), actions: () => [{ title: "Do A", why: "w", message: "m" }] },
      { id: "b", order: 2, replaces: ["sales"], build: async () => null, actions: () => [{ title: "Do B", why: "w", message: "m" }] },
    ];
    const out = await runReportSections(defs, input, () => {});
    expect([...out.replaces]).toEqual(["reputation"]);
    expect(out.actions.map((a) => a.title)).toEqual(["Do A"]);
  });

  test("the pilot's blocks and sections are registered, in order", async () => {
    vi.resetModules();
    const { BRIEF_SECTIONS, REPORT_SECTIONS } = await import("@/lib/sections");
    expect(BRIEF_SECTIONS.map((d) => d.id)).toEqual(["finance", "calendar"]);
    expect(REPORT_SECTIONS.map((d) => d.id)).toEqual(["last_week", "google_week", "next_week"]);
    expect(REPORT_SECTIONS.find((d) => d.id === "google_week")!.replaces).toEqual(["reputation", "themes", "google"]);
    expect(REPORT_SECTIONS.find((d) => d.id === "last_week")!.replaces).toEqual(["forecast"]);
  });
});

describe("the report on WhatsApp", () => {
  const data = (lines: number): ReportData => ({
    version: 1,
    restaurant: { name: "Test Kitchen", tagline: null, brandColor: "#000", brandDark: "#000" },
    period: { start: "", end: "", label: "", prevLabel: "" },
    googleMode: "dummy",
    whatsappNumber: null,
    sections: [
      { id: "headline", sentence: "s", stats: [] },
      ...["Last week", "Google", "Next week"].map((title, i) => ({
        id: "feature" as const,
        key: `k${i}`,
        title,
        stats: [{ label: "Net sales", value: { now: 1000, before: 900 }, format: "money" as const }],
        lines: Array.from({ length: lines }, (_, j) => `${title} line ${j + 1} with *bold*`),
      })),
      { id: "actions", actions: [1, 2, 3].map((n) => ({ title: `Action ${n}`, why: "", message: "" })) },
    ],
  });

  test("the sections in short, the 3 actions and the link; never over 25 lines", async () => {
    const { whatsappReport, WHATSAPP_MAX_LINES } = await import("@/lib/report/build");
    expect(WHATSAPP_MAX_LINES).toBe(25);
    for (const n of [0, 1, 3, 6, 20]) {
      const text = whatsappReport(data(n), "https://app.test/report/t", "📊 *Good week*: sales £1,000.");
      const lines = text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(25);
      expect(lines[0]).toBe("📊 *Good week*: sales £1,000.");
      expect(lines.at(-1)).toBe("Full report: https://app.test/report/t");
      expect(text).toContain("*Last week* · Net sales £1,000");
      expect(text).toMatch(/\*3 things to do\*\n1\. Action 1\n2\. Action 2\n3\. Action 3/);
      expect(text).not.toMatch(/\*bold\*/); // WhatsApp's own bold markers are taken out of section lines
    }
    expect(whatsappReport(data(3), "u", "h")).toContain("Next week line 3 with bold");
  });
});

describe("LABOUR TARGET", () => {
  test("a percentage between 0 and 100, or OFF", () => {
    expect(parseCommand("labour target 28%", 1)).toEqual({ name: "labour_target", percent: 28 });
    expect(parseCommand("LABOR TARGET 27.5", 1)).toEqual({ name: "labour_target", percent: 27.5 });
    expect(parseCommand("Labour target off", 1)).toEqual({ name: "labour_target", percent: null });
    expect(parseCommand("labour target 0", 1)).toBeNull();
    expect(parseCommand("labour target lots", 1)).toBeNull();
  });
});

describe("046_finance_calendar.sql", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await newFullDb();
  }, 120_000);
  const one = async (sql: string, params: unknown[] = []) => (await pg.query<Record<string, unknown>>(sql, params)).rows[0];

  test("records itself, runs again safely, and checks its values", async () => {
    await pg.exec(readMigration("046_finance_calendar.sql"));
    expect(await one("select count(*)::int as n from schema_migrations where name = '046_finance_calendar.sql'")).toEqual({ n: 1 });
    const id = "a0a0a0a0-0000-0000-0000-000000000046";
    await pg.query("insert into restaurants (id, name, is_demo, labour_target_pct, forecast_error_limit_pct) values ($1, 'Finance', true, 28, 20)", [id]);
    await expect(pg.query("update restaurants set labour_target_pct = 120 where id = $1", [id])).rejects.toThrow(/check/);
    await expect(pg.query("update restaurants set forecast_error_limit_pct = 0 where id = $1", [id])).rejects.toThrow(/check/);
    await pg.query("insert into forecast_backtests (restaurant_id, method, tested_on, weeks, days, error_pct, range_hit_pct) values ($1, 'history_v1', '2026-10-26', 12, 84, 7.4, 81)", [id]);
    await expect(pg.query("insert into forecast_backtests (restaurant_id, method, tested_on) values ($1, 'history_v1', '2026-10-26')", [id])).rejects.toThrow(/duplicate/);
    await pg.query("insert into calendar_suggestions (restaurant_id, event_key, day, title, question, request, offered_on) values ($1, 'sport:2026-10-31:x', '2026-10-31', 'x', 'q', 'r', '2026-10-26')", [id]);
    await expect(pg.query("insert into calendar_suggestions (restaurant_id, event_key, day, title, question, request, offered_on) values ($1, 'sport:2026-10-31:x', '2026-10-31', 'x', 'q', 'r', '2026-10-27')", [id])).rejects.toThrow(/duplicate/);
    await expect(pg.query("update calendar_suggestions set status = 'maybe' where restaurant_id = $1", [id])).rejects.toThrow(/check/);
    for (const t of ["forecast_backtests", "calendar_suggestions"]) expect(await one("select relrowsecurity as rls from pg_class where relname = $1", [t])).toEqual({ rls: true });
  });

  test("the rollback undoes it, and it can be run again after", async () => {
    await pg.exec(readMigration("rollback/finance_calendar_rollback.sql"));
    expect(await one("select to_regclass('public.forecast_backtests') is null as gone, to_regclass('public.calendar_suggestions') is null as gone2")).toEqual({ gone: true, gone2: true });
    expect(await one("select count(*)::int as n from information_schema.columns where table_name = 'restaurants' and column_name in ('labour_target_pct', 'forecast_error_limit_pct')")).toEqual({ n: 0 });
    expect(await one("select count(*)::int as n from schema_migrations where name = '046_finance_calendar.sql'")).toEqual({ n: 0 });
    await pg.exec(readMigration("046_finance_calendar.sql"));
    expect(await one("select to_regclass('public.forecast_backtests') is not null as back")).toEqual({ back: true });
  });
});
