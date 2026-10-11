import "server-only";
import { getSupabase } from "@/lib/supabase";
import { enqueueAgentJob } from "./jobs";
import { agentMode } from "./modes";

// Queues the checker agent for a new or edited draft, if the restaurant has it
// on (shadow mode for now). One job per draft version: "checker:<draft id>:v<n>".
// Never throws: queuing a check must never stop a draft reaching the owner.
export async function queueDraftCheck(draft: { id: string; restaurant_id: string; version: number }) {
  try {
    const { data: r, error } = await getSupabase()
      .from("restaurants")
      .select("agent_modes")
      .eq("id", draft.restaurant_id)
      .maybeSingle<{ agent_modes: Record<string, string> | null }>();
    // Before supabase/017_agent_jobs.sql has been run there's no agent_modes column: do nothing.
    if (error || !r) return null;
    if (agentMode(r, "checker") === "off") return null;
    return await enqueueAgentJob({
      restaurantId: draft.restaurant_id,
      key: `checker:${draft.id}:v${draft.version}`,
      agent: "checker",
      kind: "checker_shadow",
      trigger: draft.version > 1 ? "draft_edited" : "draft_created",
      draftId: draft.id,
      input: { version: draft.version },
    });
  } catch (err) {
    console.error("Couldn't queue the checker for a draft", err);
    return null;
  }
}
