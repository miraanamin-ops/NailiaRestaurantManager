// Every Claude answer is recorded in ai_usage (lib/claude.ts -> lib/ai-usage.ts),
// against the restaurant of the job or request it ran in (lib/ai-context.ts).
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const recorded: unknown[][] = [];

beforeEach(() => {
  vi.resetModules();
  recorded.length = 0;
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/ai-usage", () => ({ recordAiUsage: async (...args: unknown[]) => void recorded.push(args) }));
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class {
      beta = {
        messages: {
          parse: async (p: { model: string }) => ({ model: p.model, usage: { input_tokens: 100, output_tokens: 20 }, parsed_output: { ok: true } }),
          create: async (p: { model: string; stream?: boolean }) => (p.stream ? { stream: true } : { model: p.model, usage: { input_tokens: 5, output_tokens: 1 } }),
        },
      };
    },
  }));
});
afterEach(() => vi.resetModules());

test("a parse call is recorded with its purpose and the running job's restaurant", async () => {
  const { claude } = await import("@/lib/claude");
  const { withAiContext } = await import("@/lib/ai-context");
  const res = await withAiContext({ restaurantId: "r-1", jobType: "owner_message" }, () =>
    claude("sales").beta.messages.parse({ model: "claude-sonnet-5-5", max_tokens: 10, messages: [] } as never),
  );
  expect((res as unknown as { parsed_output: unknown }).parsed_output).toEqual({ ok: true });
  expect(recorded).toEqual([["sales", "claude-sonnet-5-5", { input_tokens: 100, output_tokens: 20 }, undefined]]);
  const { aiContext } = await import("@/lib/ai-context");
  expect(await withAiContext({ restaurantId: "r-1" }, async () => aiContext().restaurantId)).toBe("r-1");
  expect(aiContext().restaurantId).toBeUndefined(); // gone again outside
});

test("create is recorded too, but a stream (no usage yet) isn't", async () => {
  const { claude } = await import("@/lib/claude");
  await claude("assistant", "r-2").beta.messages.create({ model: "claude-haiku-5-5", max_tokens: 10, messages: [] } as never);
  await claude("assistant").beta.messages.create({ model: "claude-haiku-5-5", max_tokens: 10, messages: [], stream: true } as never);
  expect(recorded).toEqual([["assistant", "claude-haiku-5-5", { input_tokens: 5, output_tokens: 1 }, "r-2"]]);
});

test("every Claude call in the app names what it's for", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.tsx?$/.test(f) ? [join(dir, f)] : []));
  const bare = files("src").filter((f) => /\bclaude\(\)\./.test(readFileSync(f, "utf8")));
  expect(bare).toEqual([]);
});
