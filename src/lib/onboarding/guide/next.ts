import "server-only";
import { stepState, type FlowStepKey } from "../flow";
import { factsFor, loadFlow, patchStepData } from "../sessions";
import type { DinaReply } from "../dina/reply";
import { availableChapters, chapterIntro, chapterOf } from "./chapters";
import { askFor, inputsFrom, recapText } from "./cards";
import { isRecap, nextAction, type Facts, type NextAction } from "./questions";

// After every turn: what setup asks next, decided by code (guide/questions.ts).
//   - one of code's questions, or a chapter's recap: code sends it itself
//   - one of Dina's: she's told exactly what to ask (a note for her turn)
//   - the first question of a new chapter comes after the chapter's opening line
// Both channels use this, from turn.ts.

export type GuideMessage = DinaReply["messages"][number];
export type GuideNext = { action: NextAction; messages: GuideMessage[]; dinaNote: string | null };

// The chapter's opening line, once per chapter (not the first: Dina's hello opens setup).
async function introFor(restaurantId: string, step: FlowStepKey, facts: Facts): Promise<GuideMessage[]> {
  const chapter = chapterOf(step);
  if (!chapter || chapter.key === availableChapters()[0]?.key) return [];
  const first = chapter.steps[0];
  if (stepState(facts.state, first).data.intro_at) return [];
  const { state } = await loadFlow(restaurantId);
  if (stepState(state, first).status === "not_started") {
    const { noteStep } = await import("../sessions");
    await noteStep(restaurantId, first, { intro_at: new Date().toISOString() });
  } else await patchStepData(restaurantId, first, { intro_at: new Date().toISOString() });
  return [{ text: chapterIntro(chapter), component: null }];
}

// Code's question cards need their choices ready first: the logo and colours
// from the website, the tone replies (real reviews where there are good ones).
async function prepare(restaurantId: string, action: NextAction) {
  if (action.kind !== "ask") return false;
  if (action.step === "look") {
    const { prepareBrand } = await import("../dina/details-step");
    await prepareBrand(restaurantId).catch((err) => console.error("Couldn't prepare the brand choices", err));
    return true;
  }
  // The staffing card (suggested for their size, or learnt from their rotas) and the labour target from their rotas.
  if (action.step === "team" && (action.question.id === "team.staffing" || action.question.id === "team.labour")) {
    const { prepareStaffing, prepareLabour } = await import("@/lib/rota/import");
    if (action.question.id === "team.staffing") await prepareStaffing(restaurantId).catch((err) => console.error("Couldn't prepare the staffing card", err));
    else await prepareLabour(restaurantId).catch((err) => console.error("Couldn't work out the labour from the rotas", err));
    return false;
  }
  if (action.step === "tone") {
    const { prepareToneOptions } = await import("../dina/tone-step");
    await prepareToneOptions(restaurantId).catch((err) => console.error("Couldn't prepare the tone choices", err));
    return true;
  }
  return false;
}

export async function loadFacts(restaurantId: string) {
  const { state } = await loadFlow(restaurantId);
  return factsFor(restaurantId, state);
}

export async function guideNext(restaurantId: string): Promise<GuideNext> {
  let facts = await loadFacts(restaurantId);
  let action = nextAction(facts);
  if (await prepare(restaurantId, action)) {
    facts = await loadFacts(restaurantId);
    action = nextAction(facts);
  }
  if (action.kind === "end") return { action, messages: [], dinaNote: null };
  const intro = await introFor(restaurantId, action.step, facts);
  if (action.kind === "recap") return { action, messages: [...intro, { text: recapText(action.chapter), component: { type: "recap", chapter: action.chapter } }], dinaNote: null };
  if (action.kind === "ask") {
    const { setupExtras } = await import("../dina/setup-config");
    const extras = await setupExtras(restaurantId);
    const asked = askFor(action.question.id, facts, inputsFrom({ restaurant: facts.r, state: facts.state, tones: extras.tones, templateLinks: extras.templateLinks }));
    if (asked) return { action, messages: [...intro, { text: asked.text, component: { type: "question", q: action.question.id } }], dinaNote: null };
  }
  const brief = action.kind === "dina" ? action.question?.brief : null;
  return {
    action,
    messages: intro,
    dinaNote: brief ? `Next, ask about ${brief}.${intro.length ? " Code has just said which chapter this is, so don't repeat it." : ""}` : null,
  };
}

// Is code's question (or recap) already the last thing on screen, unanswered?
export function alreadyAsking(lastDinaParts: unknown[] | null | undefined, action: NextAction, ownerSpokeSince: boolean) {
  if (ownerSpokeSince) return false;
  const p = (lastDinaParts?.[0] ?? null) as { type?: string; q?: string; chapter?: string } | null;
  if (action.kind === "ask") return p?.type === "question" && p.q === action.question.id;
  if (action.kind === "recap") return p?.type === "recap" && p.chapter === action.chapter;
  return false;
}

export const codeAsksNext = (action: NextAction) => action.kind === "ask" || action.kind === "recap";
export { isRecap };
