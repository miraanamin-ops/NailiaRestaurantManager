import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PRICES } from "@/lib/agents/usage";
import { FLOW_STEPS, type FlowStepKey } from "../flow";

// Dina's settings live in agents/dina.config.json, not in code: the models, the
// thinking effort, how many tool rounds and past messages she gets, and the most
// tokens (thinking included) per step. Checked here; a bad file stops Dina with
// a clear error rather than running on a guess (tests/dina.test.ts).

const KNOWN_MODELS = Object.keys(PRICES);
const model = z.string().refine((m) => KNOWN_MODELS.includes(m), { message: `must be one of ${KNOWN_MODELS.join(", ")} (so its cost can be logged)` });
const tokens = z.number().int().min(500).max(64_000);

const Schema = z
  .object({
    model,
    router_model: model,
    effort: z.enum(["low", "medium", "high"]),
    // "adaptive": Claude thinks when it helps. "off": no thinking before a reply
    // (Sonnet 5.5's between_tools mode), for speed. Optional; adaptive if missing.
    thinking: z.enum(["adaptive", "off"]).optional(),
    max_tool_rounds: z.number().int().min(1).max(10),
    history_messages: z.number().int().min(2).max(60),
    max_tokens: z
      .object({ default: tokens, router: tokens })
      .catchall(tokens)
      .refine((m) => Object.keys(m).every((k) => k === "default" || k === "router" || (FLOW_STEPS as readonly string[]).includes(k)), {
        message: "max_tokens keys must be default, router or a step name",
      }),
  })
  .passthrough();

export type DinaConfig = {
  model: string;
  routerModel: string;
  effort: "low" | "medium" | "high";
  thinking: "adaptive" | "off";
  maxToolRounds: number;
  historyMessages: number;
  maxTokens: (step: FlowStepKey | "router") => number;
};

export function parseDinaConfig(raw: unknown): DinaConfig {
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) throw new Error(`agents/dina.config.json: ${parsed.error.issues.map((i) => `${i.path.join(".") || "file"} ${i.message}`).join("; ")}`);
  const c = parsed.data;
  const limits = c.max_tokens as Record<string, number>;
  return {
    model: c.model,
    routerModel: c.router_model,
    effort: c.effort,
    thinking: c.thinking ?? "adaptive",
    maxToolRounds: c.max_tool_rounds,
    historyMessages: c.history_messages,
    maxTokens: (step) => limits[step] ?? limits.default,
  };
}

let cached: DinaConfig | null = null;

// Read once per server instance (the file is bundled into every function: next.config.ts).
export function dinaConfig(): DinaConfig {
  if (process.env.NODE_ENV === "development") cached = null;
  cached ??= parseDinaConfig(JSON.parse(readFileSync(join(process.cwd(), "agents", "dina.config.json"), "utf8")));
  return cached;
}
