// The agent loader: every file in /agents parses, names a known model, lists
// its tools as an allow-list, and has a changelog line for its version.
// Offline: reads the real files, no network.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  AGENT_NAMES,
  assertToolAllowed,
  buildDefinition,
  changelogHasVersion,
  parseFrontMatter,
  section,
  sendsPublishesOrSpends,
  ToolNotAllowedError,
} from "@/lib/agents/definition";
import { loadAgent } from "@/lib/agents/loader";

const read = (f: string) => readFileSync(`agents/${f}`, "utf8");

describe("front matter", () => {
  test("reads words, inline lists and trailing comments", () => {
    const { fields, body } = parseFrontMatter("---\nname: gm\nmodel: sonnet   # composing\ntools: [a, b ,c]\n---\n\n# Role\nHi");
    expect(fields).toEqual({ name: "gm", model: "sonnet", tools: ["a", "b", "c"] });
    expect(body).toBe("# Role\nHi");
  });

  test("works with Windows line endings", () => {
    expect(parseFrontMatter("---\r\nname: x\r\n---\r\nbody").fields.name).toBe("x");
  });

  test("a file without front matter is refused", () => {
    expect(() => parseFrontMatter("# Role")).toThrow(/front matter/);
  });

  test("an unknown model is refused", () => {
    const house = read("house-rules.md");
    expect(() => buildDefinition(house, "---\nname: x\nmodel: gpt\ntools: []\ntriggers: []\nversion: 0.1\n---\n# Role", "x.md")).toThrow(/model must be/);
  });
});

describe("every agent file", () => {
  test.each(AGENT_NAMES)("%s loads, with a known model and version", (name) => {
    const agent = loadAgent(name);
    expect(agent.name).toBe(name);
    expect(["claude-sonnet-5-5", "claude-haiku-5-5"]).toContain(agent.modelId);
    expect(agent.version).toMatch(/^\d+\.\d+$/);
    expect(agent.triggers.length).toBeGreaterThan(0);
    expect(agent.rules.length).toBeGreaterThan(0);
  });

  test.each(AGENT_NAMES)("%s has a changelog line for its current version", (name) => {
    expect(changelogHasVersion(read(`${name}.md`), loadAgent(name).version)).toBe(true);
  });

  test("house rules have a changelog line for their version", () => {
    const v = parseFrontMatter(read("house-rules.md")).fields.version as string;
    expect(changelogHasVersion(read("house-rules.md"), v)).toBe(true);
  });

  test.each(AGENT_NAMES)("%s: the system prompt is house rules first, then the agent, without changelogs", (name) => {
    const { systemPrompt } = loadAgent(name);
    expect(systemPrompt.startsWith("# House rules")).toBe(true);
    expect(systemPrompt).toContain(section(parseFrontMatter(read(`${name}.md`)).body, "Role"));
    expect(systemPrompt).not.toMatch(/^# Changelog/m);
    expect(systemPrompt).not.toMatch(/^---\nname:/m);
  });

  test("the GM has a Haiku router; the others have none", () => {
    expect(loadAgent("gm").routerModelId).toBe("claude-haiku-5-5");
    expect(loadAgent("checker").routerModelId).toBeNull();
  });

  test.each(AGENT_NAMES)("%s has no tool that sends, publishes or spends", (name) => {
    expect(loadAgent(name).tools.filter(sendsPublishesOrSpends)).toEqual([]);
  });

  test("the profile keeper can't make drafts", () => {
    expect(loadAgent("profile-keeper").tools).not.toContain("create_draft");
  });
});

describe("tool allow-list", () => {
  test("a listed tool is allowed", () => {
    expect(() => assertToolAllowed(loadAgent("checker"), "resolve_sources")).not.toThrow();
  });

  test("anything else is refused", () => {
    expect(() => assertToolAllowed(loadAgent("checker"), "create_draft")).toThrow(ToolNotAllowedError);
    expect(() => assertToolAllowed(loadAgent("reputation"), "query_metrics")).toThrow(ToolNotAllowedError);
  });

  test("tools that would act on the world are recognised", () => {
    expect(sendsPublishesOrSpends("send_email")).toBe(true);
    expect(sendsPublishesOrSpends("publish_post")).toBe(true);
    expect(sendsPublishesOrSpends("get_post_history")).toBe(false);
    expect(sendsPublishesOrSpends("send_owner_message")).toBe(false);
  });
});

test("the agent files are bundled into the Vercel build", () => {
  expect(readFileSync("next.config.ts", "utf8")).toMatch(/outputFileTracingIncludes[\s\S]*\.\/agents\/\*\.md/);
});
