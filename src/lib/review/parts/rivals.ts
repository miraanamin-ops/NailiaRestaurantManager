import "server-only";
import { findRivals } from "../rivals";
import { logTimeSaved } from "../time-saved";
import type { PartResults } from "../types";
import type { PartContext } from ".";

// You vs nearby rivals (lib/review/rivals.ts). Works without Google connected:
// it's all public Places data.
export async function rivalsPart(ctx: PartContext): Promise<PartResults["rivals"]> {
  const out = await findRivals(ctx.restaurant);
  await logTimeSaved(ctx.restaurant.id, "rival_check", `${ctx.review.id}:rivals`);
  return out;
}
