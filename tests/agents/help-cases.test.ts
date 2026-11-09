// Part 5's case files are well formed, and the judges catch the mistakes they must.
import { describe, expect, test } from "vitest";
import { judgeAdvice, judgeFaq, judgeTopic, loadAdvice, loadFaq, loadTopics } from "./support/help-cases";

describe("the case files", () => {
  test("about 30 FAQ, 15 advice and 15 topic cases, covering what the owner asked for", () => {
    const faq = loadFaq();
    const advice = loadAdvice();
    const topics = loadTopics();
    expect(faq.length).toBeGreaterThanOrEqual(30);
    expect(advice.length).toBeGreaterThanOrEqual(15);
    expect(topics.length).toBeGreaterThanOrEqual(15);
    expect(faq.some((c) => /import a customer data list/.test(c.question))).toBe(true);
    expect(faq.some((c) => c.not_yet_any)).toBe(true);
    expect(faq.some((c) => c.action)).toBe(true);
    expect(faq.some((c) => !c.covered)).toBe(true);
    expect(advice.some((c) => /margins/.test(c.question)) && advice.some((c) => /revenue next year/.test(c.question))).toBe(true);
    expect(advice.some((c) => c.mention_any?.includes("Acas"))).toBe(true);
    expect(topics.find((c) => /cows/.test(c.message))!.routes).toEqual(["off_topic"]);
    expect(topics.find((c) => /minimum wage/.test(c.message))!.routes).toEqual(["advice"]);
  });
});

describe("the judges", () => {
  const importCase = loadFaq().find((c) => /import a customer data list/.test(c.question))!;
  const good = { covered: true, message: "Just send the file here, or tap *Customers*, then *Import customers*.", action: null };

  test("FAQ", () => {
    expect(judgeFaq(importCase, "how_to", good, true)).toEqual([]);
    expect(judgeFaq(importCase, "chat", good, true).join()).toMatch(/routed to chat/);
    expect(judgeFaq(importCase, "how_to", { ...good, message: "Sorry, I couldn't do that one just now." }, true).join()).toMatch(/should mention/);
    expect(judgeFaq(importCase, "how_to", good, false).join()).toMatch(/fact check/);
    expect(judgeFaq(importCase, "how_to", { ...good, message: `${good.message} The GM handles it.` }, true).join()).toMatch(/must not contain "GM"/);
  });

  test("advice", () => {
    const c = loadAdvice()[0];
    const idea = (why: string) => ({ title: "Push lamb chops", why, message: "Post the lamb chops on Google" });
    const output = { type: "advice", channel: "owner", content: { headline: "Three ideas:", body: "", actions: [idea("They keep 72% profit."), idea("General: post weekly."), idea("General: check the rota.")] }, figures: [], confidence: "high", needs_owner_input: null, sources_used: ["menu:profit"] } as never;
    expect(judgeAdvice(c, "advice", { kind: "reply", output, checker: "pass", text: "x" })).toEqual([]);
    const allGeneral = { ...(output as object), content: { headline: "x", body: "", actions: [idea("General: a."), idea("General: b."), idea("General: c.")] } } as never;
    expect(judgeAdvice(c, "advice", { kind: "reply", output: allGeneral, checker: "pass", text: "x" }).join()).toMatch(/no idea is tied/);
    expect(judgeAdvice(c, "insights", { kind: "question", output: null, checker: null, text: "Which?" }).join()).toMatch(/routed to insights.*no ideas/);
  });

  test("topics", () => {
    expect(judgeTopic({ message: "how many cows?", routes: ["off_topic"] }, "chat")).toEqual(["routed to chat, expected off_topic"]);
  });
});
