import "server-only";
import { z } from "zod";
import { saveProfileFields } from "@/lib/profile-edits";
import { FlowError, FLOW_STEPS, isFlowStep, STEP_DEFS, type FlowStepKey } from "../flow";
import { completeStep, enterStep, skipStep, type Channel } from "../sessions";
import { getRestaurant } from "../store";

// Dina's tools: the only way anything she hears is saved. Each checks its input in
// code (a zod schema, then its own rules) and either saves and says what it saved,
// or refuses with the exact problem, which goes back to Dina so she can ask the
// owner. A step's status only ever changes here, never because Dina says so.
// The allow-list is the tools line in agents/dina.md (checked in agent.ts).

export type ToolContext = { restaurantId: string; channel: Channel };
export type ToolResult = { ok: true; text: string } | { ok: false; text: string };

export type DinaTool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolResult>;
};

const tool = <S extends z.ZodType>(t: DinaTool<S>) => t as unknown as DinaTool;
const stepKey = z.enum(FLOW_STEPS);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (max: number) => z.string().transform(clean).pipe(z.string().min(1, "is empty").max(max, `is longer than ${max} characters`));

export const TOOLS: DinaTool[] = [
  tool({
    name: "save_hello",
    description:
      "Save step 1 (Hello) once the owner has confirmed all five: their name, the restaurant's name, its address, its cuisine, and whether they're the owner or a manager. Only values the owner confirmed in this chat.",
    schema: z.object({
      owner_name: words(80),
      restaurant_name: words(80),
      address: words(200),
      cuisine: words(80),
      role: z.enum(["owner", "manager"]),
      owner_confirmed: z.literal(true).describe("true only if the owner confirmed these values in this chat"),
    }),
    async run(ctx, input) {
      if (!/\d/.test(input.address)) return { ok: false, text: "The address has no number or postcode. Ask the owner for the full address with the postcode." };
      const restaurant = await getRestaurant(ctx.restaurantId);
      await saveProfileFields(restaurant, { owner_name: input.owner_name, name: input.restaurant_name, address: input.address, cuisine: input.cuisine }, "Confirmed with Dina at setup");
      const { session } = await completeStep(ctx.restaurantId, "hello", "done", { role: input.role }, { channel: ctx.channel });
      return { ok: true, text: `Saved. Hello is done. The next step is ${session.current_step ? `${session.current_step} (${STEP_DEFS[session.current_step].title})` : "none: setup is complete"}.` };
    },
  }),
  tool({
    name: "skip_step",
    description: "Skip a step the owner wants to leave for later (only skippable steps; never Hello). It becomes a setup gap to come back to.",
    schema: z.object({ step: stepKey }),
    async run(ctx, input) {
      const { session } = await skipStep(ctx.restaurantId, input.step, { channel: ctx.channel });
      return { ok: true, text: `Skipped ${STEP_DEFS[input.step].title}. The next step is ${session.current_step ?? "none: every step is dealt with"}.` };
    },
  }),
  tool({
    name: "go_to_step",
    description: "Go to a step because the owner asked to (go back, change an earlier answer, or do a skipped step now).",
    schema: z.object({ step: stepKey }),
    async run(ctx, input) {
      await enterStep(ctx.restaurantId, input.step, { channel: ctx.channel });
      return { ok: true, text: `Now on ${STEP_DEFS[input.step].title}. What we hold for it is in the setup state; carry on there.` };
    },
  }),
];

// JSON Schema for Claude, from the same zod schema the input is checked against.
export function toolDefinitions(tools: DinaTool[]) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: z.toJSONSchema(t.schema, { io: "input" }) as { type: "object" } }));
}

// Runs one tool call: unknown tools, bad input and refused actions all come back
// as a problem for Dina, never as a crash.
export async function runTool(ctx: ToolContext, tools: DinaTool[], name: string, input: unknown): Promise<ToolResult> {
  const t = tools.find((x) => x.name === name);
  if (!t) return { ok: false, text: `There's no tool called ${name}.` };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return { ok: false, text: `Not saved: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}.` };
  try {
    return await t.run(ctx, parsed.data);
  } catch (err) {
    if (err instanceof FlowError) return { ok: false, text: `Not done: ${err.message}.` };
    throw err;
  }
}

export const stepFrom = (v: unknown): FlowStepKey | null => (typeof v === "string" && isFlowStep(v) ? v : null);
