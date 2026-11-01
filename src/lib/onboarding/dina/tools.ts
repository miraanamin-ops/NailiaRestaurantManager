import "server-only";
import { z } from "zod";
import { saveProfileFields } from "@/lib/profile-edits";
import { FlowError, FLOW_STEPS, isFlowStep, STEP_DEFS, type FlowStepKey } from "../flow";
import { completeStep, enterStep, loadFlow, noteStep, skipStep, type Channel } from "../sessions";
import { UK_ALLERGENS } from "../profile-data";
import { getRestaurant } from "../store";
import { BRIEF_HOURS, MAX_CAP, MIN_CAP, STAFF_ROLES } from "./ops-content";

// Dina's tools: the only way anything she hears is saved. Each checks its input in
// code (a zod schema, then its own rules) and either saves and says what it saved,
// or refuses with the exact problem, which goes back to Dina so she can ask the
// owner. A step's status only ever changes here, never because Dina says so.
// The allow-list is the tools line in agents/dina.md (checked in agent.ts).

// onStatus: a short line for the owner while a tool runs ("Saving your basics…"), streamed by the web chat.
export type ToolContext = { restaurantId: string; channel: Channel; onStatus?: (text: string) => void };
export type ToolResult = { ok: true; text: string } | { ok: false; text: string };

export type DinaTool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  // What the owner sees while it runs.
  status: string;
  schema: S;
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolResult>;
};

const tool = <S extends z.ZodType>(t: DinaTool<S>) => t as unknown as DinaTool;
const stepKey = z.enum(FLOW_STEPS);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (max: number) => z.string().transform(clean).pipe(z.string().min(1, "is empty").max(max, `is longer than ${max} characters`));

export const TOOLS: DinaTool[] = [
  tool({
    name: "note_hello",
    status: "Noting that down…",
    description:
      "Note any of the Hello basics the owner has just told you (only what they said; leave the rest out). Nothing is saved for real: it fills the basics card for them to check. Call it before showing the basics card.",
    schema: z
      .object({
        owner_name: words(80).optional(),
        restaurant_name: words(80).optional(),
        address: words(200).optional(),
        cuisine: words(80).optional(),
        role: z.enum(["owner", "manager"]).optional(),
      })
      .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "has nothing to note" }),
    async run(ctx, input) {
      const { state } = await loadFlow(ctx.restaurantId);
      const before = (state.hello?.data.draft ?? {}) as Record<string, unknown>;
      await noteStep(ctx.restaurantId, "hello", { draft: { ...before, ...input } }, { channel: ctx.channel });
      return { ok: true, text: `Noted (not saved yet): ${Object.keys(input).join(", ")}. Show the basics card so the owner can check it.` };
    },
  }),
  tool({
    name: "save_hello",
    status: "Saving your basics…",
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
    status: "Noting that for later…",
    description: "Skip a step the owner wants to leave for later (only skippable steps; never Hello). It becomes a setup gap to come back to.",
    schema: z.object({ step: stepKey }),
    async run(ctx, input) {
      const { session } = await skipStep(ctx.restaurantId, input.step, { channel: ctx.channel });
      const { afterSkip } = await import("./answers");
      await afterSkip(ctx.restaurantId, input.step);
      return { ok: true, text: `Skipped ${STEP_DEFS[input.step].title}. The next step is ${session.current_step ?? "none: every step is dealt with"}.` };
    },
  }),
  tool({
    name: "save_tone",
    status: "Saving your tone…",
    description:
      "Save the owner's own reply as their tone for the good (praise) or bad (complaint) review: when they chose \"Write my own\" and typed it, or asked to change a reply they picked. Their words exactly, at least a sentence. A tap on a tone card is saved by code: don't call this for those.",
    schema: z.object({ voice: z.enum(["praise", "complaint"]), own_reply: words(1200).refine((t) => t.split(" ").length >= 4, "is too short for a reply") }),
    async run(ctx, input) {
      const { saveToneChoice } = await import("./tone-step");
      return { ok: true, text: await saveToneChoice(ctx.restaurantId, input.voice, { own: input.own_reply }, ctx.channel) };
    },
  }),
  tool({
    name: "save_make_it_right",
    status: "Saving how you make it right…",
    description:
      "Save step 4 (making it right) once the owner has told you what you may offer unhappy customers and who handles complaints. Offers in their words (e.g. 'Invite them back for a free dessert', 'Ask them to call us so we can sort it out'); nothing over their discount cap (code checks). handler: who handles complaints (name and role); contact: how customers reach them, if given.",
    schema: z.object({ offers: z.array(words(120)).min(1).max(5), handler: words(80), contact: words(120).nullable().optional() }),
    async run(ctx, input) {
      const { saveMakeItRight } = await import("./facts-step");
      return saveMakeItRight(ctx.restaurantId, input, ctx.channel);
    },
  }),
  tool({
    name: "correct_menu",
    status: "Updating your menu…",
    description:
      "Change the menu (the draft they're checking, or the saved one) the way the owner says, in their words: e.g. 'Lamb chops are £14', 'remove the samosa', 'add Mango Lassi £3.50 to Drinks'. Not for allergens (set_allergens).",
    schema: z.object({ instruction: words(600) }),
    async run(ctx, input) {
      const { correctMenu } = await import("./menu-step");
      return correctMenu(ctx.restaurantId, input.instruction);
    },
  }),
  tool({
    name: "set_allergens",
    status: "Saving the allergens…",
    description:
      "After the owner chose 'Change it' on an allergen card and told you a dish's allergens: save exactly those (of the UK's 14; an empty list means none). Their words only: never add one they didn't say. The dish's name as on the card.",
    schema: z.object({ dish: words(120), allergens: z.array(z.enum(UK_ALLERGENS)).max(14) }),
    async run(ctx, input) {
      const { setAllergens } = await import("./menu-step");
      return setAllergens(ctx.restaurantId, input.dish, input.allergens, ctx.channel);
    },
  }),
  tool({
    name: "confirm_sales_columns",
    status: "Importing your sales…",
    description:
      "Step 7: import the sales file once the owner has said the columns code read look right (or that they fixed them on the import page). Code imports it and says how much history arrived.",
    schema: z.object({ owner_confirmed: z.literal(true).describe("true only if the owner said the columns are right, or that they fixed them") }),
    async run(ctx) {
      const { confirmSalesColumns } = await import("./ops-step");
      return confirmSalesColumns(ctx.restaurantId, ctx.channel);
    },
  }),
  tool({
    name: "save_team",
    status: "Saving your team…",
    description:
      "Step 8: save the team once the owner has told you who works there (from chat or the staff list they sent) and their labour target. staff: each person with a role (kitchen, front, delivery or manager), hourly rate in pounds and contracted hours a week if given (null if not). manager: who runs the site day to day (a name on the list, or 'me' for the owner), or null. cover_rules: the least of each role on any shift, if they said. labour_target_pct: their target as a % of sales, or null if they didn't pick one (code uses 30%, flagged). Only what they said: never guess a rate.",
    schema: z.object({
      staff: z
        .array(
          z.object({
            name: words(60),
            role: z.enum(STAFF_ROLES),
            hourly_rate: z.number().nullable(),
            contracted_hours: z.number().nullable(),
          }),
        )
        .max(40),
      manager: words(60).nullable(),
      cover_rules: z.array(z.object({ role: z.enum(STAFF_ROLES), min_on_shift: z.number().int() })).max(4),
      labour_target_pct: z.number().nullable(),
    }),
    async run(ctx, input) {
      const { saveTeam } = await import("./ops-step");
      return saveTeam(ctx.restaurantId, input, ctx.channel);
    },
  }),
  tool({
    name: "save_rewards",
    status: "Saving your rewards…",
    description:
      `Step 9: save the sign-up reward (in their words, e.g. "a free dessert", "10% off your first visit") and the discount cap: the most off any offer can ever be, a whole number from ${MIN_CAP} to ${MAX_CAP}. Code checks the reward fits the cap.`,
    schema: z.object({ signup_reward: words(80), discount_cap_percent: z.number().int() }),
    async run(ctx, input) {
      const { saveRewards } = await import("./ops-step");
      return saveRewards(ctx.restaurantId, input, ctx.channel);
    },
  }),
  tool({
    name: "send_qr_kit",
    status: "Sending your QR codes…",
    description: "Step 10: email (and WhatsApp, if linked) the owner their printable QR codes, once they say yes to having them. No input.",
    schema: z.object({}),
    async run(ctx) {
      const { sendQrKit } = await import("./ops-step");
      return sendQrKit(ctx.restaurantId, ctx.channel);
    },
  }),
  tool({
    name: "save_timing",
    status: "Saving your timings…",
    description: `Step 12: save when the morning brief comes (brief_hour: one of ${BRIEF_HOURS.join(", ")}, meaning am) and the hours customer messages may go out (quiet_start and quiet_end as HH:MM, e.g. 09:00 and 21:00). Use the defaults (9, 09:00, 21:00) for anything they were happy to leave.`,
    schema: z.object({ brief_hour: z.number().int(), quiet_start: z.string().max(5), quiet_end: z.string().max(5) }),
    async run(ctx, input) {
      const { saveTiming } = await import("./ops-step");
      return saveTiming(ctx.restaurantId, input, ctx.channel);
    },
  }),
  tool({
    name: "go_to_step",
    status: "Opening that step…",
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

// What Claude is offered. note_hello isn't: Dina notes the basics in her reply's
// hello_notes instead (one Claude call, not two), and code runs note_hello on them.
export const OFFERED_TOOLS: DinaTool[] = TOOLS.filter((t) => t.name !== "note_hello");

// Runs one tool call: unknown tools, bad input and refused actions all come back
// as a problem for Dina, never as a crash.
export async function runTool(ctx: ToolContext, tools: DinaTool[], name: string, input: unknown): Promise<ToolResult> {
  const t = tools.find((x) => x.name === name);
  if (!t) return { ok: false, text: `There's no tool called ${name}.` };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return { ok: false, text: `Not saved: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}.` };
  ctx.onStatus?.(t.status);
  try {
    return await t.run(ctx, parsed.data);
  } catch (err) {
    if (err instanceof FlowError) return { ok: false, text: `Not done: ${err.message}.` };
    throw err;
  }
}

export const stepFrom = (v: unknown): FlowStepKey | null => (typeof v === "string" && isFlowStep(v) ? v : null);
