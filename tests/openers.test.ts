import { describe, expect, it } from "vitest";
import { briefSummary, fillTemplate, mayOpen, OPENER_KINDS, resolveOpener, templateFor, withinWindow } from "@/lib/openers";
import templates from "@/lib/whatsapp-templates.json";

const who = { ownerName: "Sam Patel", restaurantName: "Ember & Spice Grill" };
const at = (iso: string) => new Date(iso);
const HOUR = 60 * 60 * 1000;

describe("the 24-hour window", () => {
  const now = at("2026-11-09T09:00:00Z");
  it("is open within 24 hours of the owner's last message", () => {
    expect(withinWindow(new Date(now.getTime() - 23 * HOUR), now)).toBe(true);
    expect(withinWindow(new Date(now.getTime() - 25 * HOUR), now)).toBe(false);
    expect(withinWindow(null, now)).toBe(false);
  });
});

describe("which opener", () => {
  it("reads the stars from a review alert", () => {
    const o = resolveOpener("alert", "🚨 *2-star review just came in.* I've drafted a careful reply", who);
    expect(o).toEqual({ kind: "review", vars: { 1: "Sam", 2: "Ember & Spice Grill", 3: "2" } });
  });
  it("reads the stars from private feedback", () => {
    const o = resolveOpener("feedback", "🚨 *Private feedback: 1★ from Jo*", who);
    expect(o).toEqual({ kind: "feedback", vars: { 1: "Sam", 2: "Ember & Spice Grill", 3: "1" } });
  });
  it("falls back to the general opener when the stars can't be read", () => {
    expect(resolveOpener("alert", "Something else needs you", who)?.kind).toBe("update");
    expect(resolveOpener("review", "no stars here", who)?.kind).toBe("update");
  });
  it("uses 'there' with no owner name, and holds without a template for 'none'", () => {
    expect(resolveOpener("rota", "", { ownerName: null, restaurantName: "Cafe" })?.vars[1]).toBe("there");
    expect(resolveOpener("none", "🎁 Reward redeemed", who)).toBeNull();
  });
  it("brief and report wording", () => {
    expect(resolveOpener("brief", "", { ...who, briefSummary: briefSummary(3) })?.vars[3]).toBe("3 things to approve");
    expect(briefSummary(1)).toBe("1 thing to approve");
    expect(briefSummary(0)).toBe("a summary of yesterday");
    expect(resolveOpener("report", "", { ...who, reportLabel: "October" })?.vars).toEqual({ 1: "Sam", 2: "October", 3: "Ember & Spice Grill" });
  });
});

describe("when an opener may go", () => {
  const now = at("2026-11-09T09:00:00Z");
  const ago = (h: number) => new Date(now.getTime() - h * HOUR);
  it("always for the first one and for the brief", () => {
    expect(mayOpen("update", { now, lastOpenerAt: null, lastInboundAt: null })).toBe(true);
    expect(mayOpen("brief", { now, lastOpenerAt: ago(0.01), lastInboundAt: null })).toBe(true);
  });
  it("not while a recent one is unanswered; yes once answered or 20 hours on", () => {
    expect(mayOpen("rota", { now, lastOpenerAt: ago(5), lastInboundAt: ago(30) })).toBe(false);
    expect(mayOpen("rota", { now, lastOpenerAt: ago(5), lastInboundAt: ago(4) })).toBe(true);
    expect(mayOpen("rota", { now, lastOpenerAt: ago(21), lastInboundAt: null })).toBe(true);
  });
  it("urgent alerts go anyway, but not twice within 10 minutes", () => {
    expect(mayOpen("review", { now, lastOpenerAt: ago(1), lastInboundAt: null })).toBe(true);
    expect(mayOpen("feedback", { now, lastOpenerAt: new Date(now.getTime() - 5 * 60 * 1000), lastInboundAt: null })).toBe(false);
  });
});

describe("the template wording follows Meta's rules", () => {
  const all = [...OPENER_KINDS.map(templateFor), ...Object.values(templates.other)];
  it.each(all.map((t) => [t.name, t] as const))("%s", (_, t) => {
    expect(t.name).toMatch(/^[a-z0-9_]+$/);
    expect(t.body).not.toMatch(/^\s*\{\{/); // no variable at the start
    expect(t.body).not.toMatch(/\}\}\s*[.!]?\s*$/); // or at the end
    expect(t.body.length).toBeLessThanOrEqual(1024);
    const used = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
    expect(used.map(Number)).toEqual(used.map((_, i) => i + 1)); // 1, 2, 3 in order
    expect(Object.keys(t.sample).sort()).toEqual([...new Set(used)].sort()); // a sample for each
    expect(fillTemplate(t.body, t.sample)).not.toContain("{{");
  });
  it("names are unique", () => {
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length);
  });
});
