// Reads the agent files in /agents (runtime prompts for DinerAI's own agents)
// into definitions the code can use: model, tools, triggers, version, and the
// system prompt (house rules first, then the agent's own file).
// No imports, so every rule is unit-tested (tests/agents/loader.test.ts).

export const AGENT_NAMES = ["gm", "reputation", "growth", "visibility", "insights", "checker", "profile-keeper"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const MODEL_TIERS = ["sonnet", "haiku"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export type AgentMeta = {
  name: string;
  model: ModelTier;
  routerModel: ModelTier | null;
  tools: string[];
  triggers: string[];
  version: string;
};

export type AgentDefinition = AgentMeta & {
  // House rules + the agent's file, as sent to Claude.
  systemPrompt: string;
  // The agent's "# Rules" section, for the checker's C8 (get_maker_rules).
  rules: string;
  houseRulesVersion: string;
};

// "key: value  # comment" lines between two "---" lines at the top of the file.
// Values are plain words or inline lists: [a, b, c].
export function parseFrontMatter(text: string): { fields: Record<string, string | string[]>; body: string } {
  const normalised = text.replace(/\r\n/g, "\n");
  const match = normalised.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error("No front matter (the file must start with a --- block)");
  const fields: Record<string, string | string[]> = {};
  for (const raw of match[1].split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 1) throw new Error(`Can't read front matter line: "${raw}"`);
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fields[key] = /^\[.*\]$/.test(value)
      ? value
          .slice(1, -1)
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : value;
  }
  return { fields, body: normalised.slice(match[0].length).trim() };
}

const asTier = (value: unknown, field: string, file: string): ModelTier => {
  if (typeof value === "string" && (MODEL_TIERS as readonly string[]).includes(value)) return value as ModelTier;
  throw new Error(`${file}: ${field} must be one of ${MODEL_TIERS.join(", ")} (got "${String(value)}")`);
};
const asList = (value: unknown, field: string, file: string) => {
  if (Array.isArray(value)) return value;
  throw new Error(`${file}: ${field} must be a list like [a, b]`);
};

export function agentMeta(fields: Record<string, string | string[]>, file: string): AgentMeta {
  const version = fields.version;
  if (typeof version !== "string" || !/^\d+\.\d+$/.test(version)) throw new Error(`${file}: version must look like 0.2`);
  if (typeof fields.name !== "string" || !fields.name) throw new Error(`${file}: name is missing`);
  return {
    name: fields.name,
    model: asTier(fields.model, "model", file),
    routerModel: fields.router_model === undefined ? null : asTier(fields.router_model, "router_model", file),
    tools: asList(fields.tools, "tools", file),
    triggers: asList(fields.triggers, "triggers", file),
    version,
  };
}

// The text of one "# Heading" section (up to the next top-level heading).
export function section(body: string, heading: string) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `# ${heading}`);
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^# /.test(l));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

// The changelog is for people, not for the agent: it's left out of the prompt.
function withoutChangelog(body: string) {
  const at = body.search(/^# Changelog\s*$/m);
  return (at < 0 ? body : body.slice(0, at)).trim();
}

export function buildDefinition(houseRulesText: string, agentText: string, file: string): AgentDefinition {
  const house = parseFrontMatter(houseRulesText);
  const agent = parseFrontMatter(agentText);
  const meta = agentMeta(agent.fields, file);
  const houseVersion = typeof house.fields.version === "string" ? house.fields.version : "?";
  return {
    ...meta,
    houseRulesVersion: houseVersion,
    rules: section(agent.body, "Rules"),
    systemPrompt: `${withoutChangelog(house.body)}\n\n---\n\n${withoutChangelog(agent.body)}`,
  };
}

// The changelog must have a line for the current version ("- 0.2 (11 Oct 2026): ...").
export function changelogHasVersion(text: string, version: string) {
  const body = parseFrontMatter(text).body;
  return new RegExp(`^- ${version.replace(".", "\\.")} \\(`, "m").test(section(body, "Changelog"));
}

// Tools are an allow-list: an agent may only ever be offered (or have code run
// for it) the tools listed in its front matter.
export class ToolNotAllowedError extends Error {}

export function assertToolAllowed(def: Pick<AgentMeta, "name" | "tools">, tool: string) {
  if (!def.tools.includes(tool)) throw new ToolNotAllowedError(`The ${def.name} agent isn't allowed the ${tool} tool`);
}

// Tools that send, publish or spend never go to an agent: only the release gate does that.
// (The GM's send_owner_message is the one exception: it only reaches the owner, through code.)
const ACTS_ON_THE_WORLD = /^(send|publish|post|spend|pay|refund|charge|email|sms|whatsapp|delete)_/;
export function sendsPublishesOrSpends(tool: string) {
  return tool !== "send_owner_message" && ACTS_ON_THE_WORLD.test(tool);
}
