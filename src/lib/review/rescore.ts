import "server-only";
import type { Draft } from "@/lib/drafts";
import type { Restaurant } from "@/lib/supabase";
import { withFixes, type ApplyFix } from "./fix-plan";
import { readProfile } from "./google-profile";
import { scoreProfile } from "./health";

// The score after the profile fixes went through the gate: read again from
// Google. A dry run changed nothing, so it's the score the fixes would give.
export async function rescore(r: Restaurant, draft: Draft, note: string) {
  const snapshot = await readProfile(r);
  if (!snapshot) return null;
  const dryRun = note.startsWith("🧪");
  if (!dryRun) return { score: scoreProfile(snapshot, new Date()).score, dryRun };
  const input = (draft.agent_input ?? {}) as { apply?: ApplyFix[]; description?: string | null };
  return { score: scoreProfile(withFixes(snapshot, input.apply ?? [], input.description ?? null), new Date()).score, dryRun };
}
