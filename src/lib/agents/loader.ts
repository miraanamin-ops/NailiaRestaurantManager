import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODELS } from "@/lib/claude";
import { buildDefinition, type AgentDefinition, type AgentName } from "./definition";

// Loads an agent from /agents (house-rules.md first, then the agent's own file).
// The files are bundled into every Vercel function by outputFileTracingIncludes
// in next.config.ts. Read once per server instance, then kept.

const dir = () => join(process.cwd(), "agents");
const cache = new Map<AgentName, LoadedAgent>();

export type LoadedAgent = AgentDefinition & { modelId: string; routerModelId: string | null };

export function loadAgent(name: AgentName): LoadedAgent {
  const cached = cache.get(name);
  if (cached) return cached;
  const house = readFileSync(join(dir(), "house-rules.md"), "utf8");
  const own = readFileSync(join(dir(), `${name}.md`), "utf8");
  const def = buildDefinition(house, own, `${name}.md`);
  const loaded = { ...def, modelId: MODELS[def.model], routerModelId: def.routerModel ? MODELS[def.routerModel] : null };
  cache.set(name, loaded);
  return loaded;
}
