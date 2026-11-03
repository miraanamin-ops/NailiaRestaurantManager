import "server-only";
import type { Restaurant } from "@/lib/supabase";
import type { Part } from "../config";
import type { BusinessReview, PartResults } from "../types";

// What one part of the business review gets, and the runner for each part.
// A part that isn't built yet simply isn't listed: it's never queued, and its
// section never appears.
export type PartContext = { review: BusinessReview; restaurant: Restaurant; now: Date; connected: boolean };
export type PartRunner<P extends Part = Part> = (ctx: PartContext) => Promise<PartResults[P]>;

type Runners = { [P in Part]?: PartRunner<P> };

const RUNNERS: Runners = {};

export const registeredParts = (): Part[] => (Object.keys(RUNNERS) as Part[]).filter((p) => RUNNERS[p]);
export const runnerFor = <P extends Part>(p: P) => RUNNERS[p] as PartRunner<P> | undefined;

// Tests swap runners in and out.
export function setRunnerForTests<P extends Part>(p: P, runner: PartRunner<P> | undefined) {
  (RUNNERS as Record<string, unknown>)[p] = runner;
}
