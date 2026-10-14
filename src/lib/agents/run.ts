import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { alertBuilder } from "@/lib/builder-alerts";
import { claude, fallbackFor, MAX_TOKENS } from "@/lib/claude";
import { assertToolAllowed, type AgentName } from "./definition";
import { loadAgent } from "./loader";
import type { Problems } from "./schema";
import { addUsage, NO_TOKENS, tokensFrom, type Usage } from "./usage";

// One call to one agent: its system prompt (house rules + its file), the job's
// data, and a fixed output shape. The output is checked by code; if it's invalid
// the agent gets one retry with the problems listed, then the call fails and the
// builder is alerted (the watchdog). Never the owner.

export class AgentOutputError extends Error {
  constructor(
    readonly agent: AgentName,
    readonly problems: Problems,
    // What the failed attempts used, so the job's cost still counts them.
    readonly usage: Usage = {},
  ) {
    super(`The ${agent} agent returned invalid output twice: ${problems.join("; ")}`);
  }
}

export type AgentCall<T> = {
  agent: AgentName;
  // The job's data (profile, sources, the draft...). Text and images.
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: z.ZodType<T>;
  // Plain-code rules on top of the schema. Empty = valid.
  validate: (out: T) => Problems;
  effort?: "low" | "medium" | "high";
  // For the alert: what this call was about (e.g. a draft id).
  label: string;
  // Use the agent's router model (its front matter's router_model, e.g. the GM's Haiku router).
  router?: boolean;
};

export type AgentResult<T> = { output: T; attempts: number; agentVersion: string; houseRulesVersion: string; model: string; usage: Usage };

export async function callAgent<T>(call: AgentCall<T>): Promise<AgentResult<T>> {
  const loaded = loadAgent(call.agent);
  if (call.router && !(loaded.routerModel && loaded.routerModelId)) throw new Error(`The ${call.agent} agent has no router_model`);
  const agent = call.router ? { ...loaded, model: loaded.routerModel!, modelId: loaded.routerModelId! } : loaded;
  // The agent's instructions are the same on every call, so they're cached.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: agent.systemPrompt, cache_control: { type: "ephemeral" } }];

  let problems: Problems = [];
  let tokens = NO_TOKENS;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryNote: Anthropic.Beta.BetaContentBlockParam[] = problems.length
      ? [{ type: "text", text: `Your previous answer was rejected by the system for these reasons:\n${problems.map((p) => `- ${p}`).join("\n")}\nReturn a corrected answer.` }]
      : [];
    const response = await claude().beta.messages.parse({
      ...fallbackFor(agent.model),
      model: agent.modelId,
      max_tokens: MAX_TOKENS,
      output_config: { effort: call.effort ?? "medium", format: betaZodOutputFormat(call.schema) },
      system,
      messages: [{ role: "user", content: [...call.content, ...retryNote] }],
    });
    // Every attempt counts towards the cost, priced by the model that answered.
    tokens = addUsage({ t: tokens }, { t: tokensFrom(response.model ?? agent.modelId, response.usage) }).t;
    const out = response.parsed_output as T | null;
    if (response.stop_reason === "refusal" || !out) {
      problems = [`no usable answer (${response.stop_reason})`];
      continue;
    }
    problems = call.validate(out);
    if (!problems.length) {
      return { output: out, attempts: attempt, agentVersion: agent.version, houseRulesVersion: agent.houseRulesVersion, model: agent.modelId, usage: { [call.agent]: tokens } };
    }
  }
  await alertBuilder(
    `agent-invalid:${call.agent}`,
    `The ${call.agent} agent (v${agent.version}) returned invalid output twice for ${call.label}.\n${problems.slice(0, 5).join("\n")}`,
  );
  throw new AgentOutputError(call.agent, problems, { [call.agent]: tokens });
}

// A tool the agent may call while it works (only read tools: nothing that sends,
// publishes or spends). run gets the model's input and returns the result as text;
// a thrown error goes back to the agent as an error result, so it can correct itself.
export type AgentTool = {
  name: string;
  description: string;
  input_schema: Anthropic.Beta.BetaTool["input_schema"];
  run: (input: unknown) => Promise<string>;
};

// The most rounds of tool calls before the agent must answer.
export const MAX_TOOL_ROUNDS = 6;

// Like callAgent, but the agent can call read tools (e.g. query_metrics) before it
// answers. Every tool must be in the agent's front matter (the allow-list). The
// conversation is kept as it goes (thinking blocks included, unchanged), so a
// rejected answer is corrected with the tool results still in view.
export async function callAgentWithTools<T>(call: AgentCall<T> & { tools: AgentTool[] }): Promise<AgentResult<T>> {
  const agent = loadAgent(call.agent);
  for (const t of call.tools) assertToolAllowed(agent, t.name);
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: agent.systemPrompt, cache_control: { type: "ephemeral" } }];
  const tools: Anthropic.Beta.BetaTool[] = call.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const byName = new Map(call.tools.map((t) => [t.name, t]));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: call.content }];

  let problems: Problems = [];
  let tokens = NO_TOKENS;
  let rounds = 0;
  for (let attempt = 1; attempt <= 2; ) {
    const lastRound = rounds >= MAX_TOOL_ROUNDS;
    const response = await claude().beta.messages.parse({
      ...fallbackFor(agent.model),
      model: agent.modelId,
      max_tokens: MAX_TOKENS,
      output_config: { effort: call.effort ?? "medium", format: betaZodOutputFormat(call.schema) },
      system,
      // Once the rounds are used up, no more tool calls: the agent answers with what it has.
      tools,
      ...(lastRound ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    });
    tokens = addUsage({ t: tokens }, { t: tokensFrom(response.model ?? agent.modelId, response.usage) }).t;
    messages.push({ role: "assistant", content: response.content });

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason === "tool_use" && calls.length) {
      rounds++;
      // Every result goes back in one message.
      const results = await Promise.all(
        calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const tool = byName.get(c.name);
          if (!tool) return { type: "tool_result", tool_use_id: c.id, is_error: true, content: `No tool called ${c.name}` };
          try {
            return { type: "tool_result", tool_use_id: c.id, content: await tool.run(c.input) };
          } catch (err) {
            return { type: "tool_result", tool_use_id: c.id, is_error: true, content: err instanceof Error ? err.message : String(err) };
          }
        }),
      );
      messages.push({ role: "user", content: results });
      continue;
    }

    const out = response.parsed_output as T | null;
    problems = response.stop_reason === "refusal" || !out ? [`no usable answer (${response.stop_reason})`] : call.validate(out);
    if (!problems.length) {
      return { output: out as T, attempts: attempt, agentVersion: agent.version, houseRulesVersion: agent.houseRulesVersion, model: agent.modelId, usage: { [call.agent]: tokens } };
    }
    attempt++;
    if (response.stop_reason === "refusal") messages.pop();
    messages.push({ role: "user", content: [{ type: "text", text: `Your answer was rejected by the system for these reasons:\n${problems.map((p) => `- ${p}`).join("\n")}\nReturn a corrected answer (you can call the tools again if you need other figures).` }] });
  }
  await alertBuilder(
    `agent-invalid:${call.agent}`,
    `The ${call.agent} agent (v${agent.version}) returned invalid output twice for ${call.label}.\n${problems.slice(0, 5).join("\n")}`,
  );
  throw new AgentOutputError(call.agent, problems, { [call.agent]: tokens });
}
