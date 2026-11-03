import "server-only";
import type { Restaurant } from "@/lib/supabase";
import type { Part } from "../config";
import type { BusinessReview, PartResults } from "../types";

// What one part of the business review gets, and the runner for each part.
// A part that isn't built yet simply isn't listed: it's never queued, and its
// section never appears.
// round: 0 the first time; a part that has more to do (the reply backlog, in
// batches) returns continueWith(result so far) and runs again with round + 1.
export type PartContext = { review: BusinessReview; restaurant: Restaurant; now: Date; connected: boolean; round: number };
const MORE = Symbol("more");
export type Continue<R> = { [MORE]: true; result: R };
export const continueWith = <R>(result: R): Continue<R> => ({ [MORE]: true, result });
export const isContinue = <R>(x: R | Continue<R>): x is Continue<R> => typeof x === "object" && x !== null && MORE in x;
export type PartRunner<P extends Part = Part> = (ctx: PartContext) => Promise<PartResults[P] | Continue<PartResults[P]>>;

type Runners = { [P in Part]?: PartRunner<P> };

const RUNNERS: Runners = {
  reviews_sync: async (ctx) => (await import("./reviews")).syncPart(ctx),
  backlog: async (ctx) => (await import("./reviews")).backlogPart(ctx),
};

export const registeredParts = (): Part[] => (Object.keys(RUNNERS) as Part[]).filter((p) => RUNNERS[p]);
export const runnerFor = <P extends Part>(p: P) => RUNNERS[p] as PartRunner<P> | undefined;

// Tests swap runners in and out.
export function setRunnerForTests<P extends Part>(p: P, runner: PartRunner<P> | undefined) {
  (RUNNERS as Record<string, unknown>)[p] = runner;
}
